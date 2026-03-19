import JSZip from "jszip";
import { DEFAULT_PROGRESS, DEFAULT_SETTINGS, EXPORT_VERSION } from "./shared/constants";
import { assetPathForUrl } from "./shared/assets";
import { createManifest } from "./shared/manifest";
import { inferDesignTokens } from "./shared/tokens";
import type { AssetRecord, ExportSettings, PageSnapshot, ProgressState, RuntimeMessage } from "./shared/types";
import { normalizeUrl, pageIdFromUrl, shouldVisitUrl } from "./shared/url";

interface CrawlJob {
  url: string;
  depth: number;
}

interface ActiveRun {
  id: string;
  settings: ExportSettings;
  startUrl: string;
  siteRootUrl: string;
  windowId: number;
  startedAt: string;
  cancelled: boolean;
  queue: CrawlJob[];
  visited: Set<string>;
  pages: Array<{
    id: string;
    depth: number;
    snapshot: PageSnapshot;
    files: Record<string, string>;
  }>;
  failures: Array<{ url: string; stage: string; reason: string }>;
}

let progress: ProgressState = { ...DEFAULT_PROGRESS };
let activeRun: ActiveRun | null = null;
const PAGE_TIMEOUT_MS = 25_000;
const ASSET_TIMEOUT_MS = 12_000;

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ exportSettings: DEFAULT_SETTINGS, progress: DEFAULT_PROGRESS });
});

chrome.runtime.onStartup.addListener(() => {
  void recoverStaleRun();
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "GET_PROGRESS") {
    sendResponse(progress);
    return;
  }

  if (message.type === "OPEN_STATUS_PAGE") {
    void openStatusPage(message.payload?.runId ?? progress.runId)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  }

  if (message.type === "CANCEL_EXPORT") {
    if (activeRun) {
      activeRun.cancelled = true;
      recordEvent("warning", "Cancellation requested. The current page will finish first.");
      updateProgress({ status: "cancelled", message: "Cancelling after current page..." });
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "START_EXPORT") {
    void startExport(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        recordEvent("error", `Export failed: ${reason}`);
        updateProgress({ status: "error", message: "Export failed.", error: reason });
        sendResponse({ ok: false, error: reason });
      });
    return true;
  }
});

async function startExport(settings: ExportSettings): Promise<void> {
  if (activeRun) {
    throw new Error("An export is already running.");
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !tab.windowId) {
    throw new Error("No active tab found.");
  }

  const startUrl = normalizeUrl(tab.url);
  const siteRootUrl = new URL(startUrl).origin;
  const runId = crypto.randomUUID();
  activeRun = {
    id: runId,
    settings,
    startUrl,
    siteRootUrl,
    windowId: tab.windowId,
    startedAt: new Date().toISOString(),
    cancelled: false,
    queue: [{ url: startUrl, depth: 0 }],
    visited: new Set(),
    pages: [],
    failures: []
  };

  await chrome.storage.local.set({ exportSettings: settings });
  await openStatusPage(runId);
  recordEvent("info", `Started export from ${startUrl}`);
  updateProgress({
    runId,
    status: "running",
    message: "Crawling site...",
    pagesQueued: 1,
    pagesProcessed: 0,
    assetsCaptured: 0,
    assetsBlocked: 0,
    failures: 0,
    warnings: 0,
    currentUrl: startUrl,
    startedAt: activeRun.startedAt,
    completedAt: undefined,
    lastHeartbeat: new Date().toISOString(),
    settings,
    error: undefined
  });

  try {
    while (activeRun && activeRun.queue.length > 0 && activeRun.pages.length < settings.maxPages) {
      if (activeRun.cancelled) break;
      const next = activeRun.queue.shift();
      if (!next) continue;
      if (activeRun.visited.has(next.url)) continue;
      activeRun.visited.add(next.url);
      updateProgress({ currentUrl: next.url, message: `Capturing ${next.url}`, lastHeartbeat: new Date().toISOString() });
      recordEvent("info", `Capturing ${next.url}`);
      await processPage(next);
    }
    if (!activeRun) return;
    await finalizeRun(activeRun);
  } finally {
    activeRun = null;
  }
}

async function processPage(job: CrawlJob): Promise<void> {
  if (!activeRun) return;
  const tab = await chrome.tabs.create({ url: job.url, active: true, windowId: activeRun.windowId });
  if (!tab.id) {
    activeRun.failures.push({ url: job.url, stage: "tab-create", reason: "Tab id missing." });
    recordFailure(job.url, "tab-create", "Tab id missing.");
    return;
  }

  try {
    await withTimeout(waitForTabComplete(tab.id), PAGE_TIMEOUT_MS, `Timed out loading ${job.url}`);
    await delay(900);
    const scrapeResponse = await sendScrapeMessage(tab.id);
    if (!scrapeResponse?.ok) {
      throw new Error(scrapeResponse?.error ?? "Content script did not respond.");
    }
    const snapshot = scrapeResponse.snapshot as PageSnapshot;
    const pageId = pageIdFromUrl(snapshot.url, activeRun.pages.length + 1);
    const files: Record<string, string> = {};
    files.domHtml = `pages/${pageId}/dom.html`;
    files.computedCss = `pages/${pageId}/computed.css`;
    files.animations = `pages/${pageId}/animations.json`;
    files.viewportScreenshot = `pages/${pageId}/viewport.png`;
    if (activeRun.settings.screenshotMode === "full") {
      files.fullPageScreenshot = `pages/${pageId}/full-page.png`;
    }

    const viewportDataUrl = await chrome.tabs.captureVisibleTab(activeRun.windowId, { format: "png" });
    files.viewportScreenshot = `pages/${pageId}/viewport.png`;
    const fullPageDataUrl = activeRun.settings.screenshotMode === "full" ? viewportDataUrl : undefined;

    const assetResults = await captureAssets(snapshot.assets, activeRun.settings.captureThirdParty);
    snapshot.assets = assetResults;

    activeRun.pages.push({
      id: pageId,
      depth: job.depth,
      snapshot,
      files
    });

    enqueueLinks(snapshot.links.map((link) => link.url), job.depth + 1);

    updateProgress({
      pagesProcessed: activeRun.pages.length,
      pagesQueued: activeRun.queue.length + activeRun.pages.length,
      assetsCaptured: progress.assetsCaptured + assetResults.filter((asset) => asset.status === "captured").length,
      assetsBlocked: progress.assetsBlocked + assetResults.filter((asset) => asset.status === "blocked").length,
      message: `Captured ${snapshot.title || snapshot.url}`,
      lastHeartbeat: new Date().toISOString()
    });
    recordEvent("info", `Captured ${snapshot.title || snapshot.url}`);

    // Stash screenshots on the page record for zip assembly.
    (activeRun.pages[activeRun.pages.length - 1] as typeof activeRun.pages[number] & {
      viewportDataUrl?: string;
      fullPageDataUrl?: string;
    }).viewportDataUrl = viewportDataUrl;
    if (fullPageDataUrl) {
      (activeRun.pages[activeRun.pages.length - 1] as typeof activeRun.pages[number] & {
        fullPageDataUrl?: string;
      }).fullPageDataUrl = fullPageDataUrl;
    }
  } catch (error: unknown) {
    recordFailure(job.url, "capture", error instanceof Error ? error.message : String(error));
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

function enqueueLinks(links: string[], nextDepth: number): void {
  if (!activeRun || nextDepth > activeRun.settings.maxDepth) return;
  for (const link of links) {
    const normalized = normalizeUrl(link);
    if (activeRun.visited.has(normalized)) continue;
    if (!shouldVisitUrl(normalized, activeRun.startUrl, activeRun.settings.scope)) continue;
    if (activeRun.queue.some((job) => job.url === normalized)) continue;
    activeRun.queue.push({ url: normalized, depth: nextDepth });
    if (activeRun.queue.length + activeRun.pages.length >= activeRun.settings.maxPages) break;
  }
}

async function captureAssets(assets: AssetRecord[], includeThirdParty: boolean): Promise<AssetRecord[]> {
  const results: AssetRecord[] = [];
  for (const asset of assets) {
    if (asset.url.startsWith("blob:")) {
      results.push({
        ...asset,
        status: "skipped",
        reason: "Runtime blob URL cannot be fetched from the background worker."
      });
      continue;
    }

    if (asset.url.startsWith("data:")) {
      results.push({
        ...asset,
        status: "skipped",
        reason: "Inline data URL is already embedded in the page snapshot."
      });
      continue;
    }

    const url = new URL(asset.url);
    if (!includeThirdParty && activeRun && url.origin !== activeRun.siteRootUrl) {
      results.push({ ...asset, status: "skipped", reason: "Third-party capture disabled." });
      continue;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);
      const response = await fetch(asset.url, { credentials: "include", signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) {
        results.push({ ...asset, status: "blocked", reason: `HTTP ${response.status}` });
        recordWarning(`Blocked asset ${asset.url}: HTTP ${response.status}`);
        continue;
      }
      const mimeType = response.headers.get("content-type") ?? asset.mimeType;
      const blob = await response.blob();
      const path = assetPathForUrl(asset.url, mimeType);
      const bytes = await blob.arrayBuffer();
      cachedBinaryAssets.set(path, bytes);
      results.push({
        ...asset,
        mimeType: mimeType ?? undefined,
        type: asset.type,
        status: "captured",
        path
      });
    } catch (error: unknown) {
      results.push({
        ...asset,
        status: "blocked",
        reason: error instanceof Error ? error.message : String(error)
      });
      recordWarning(`Blocked asset ${asset.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return results;
}

const cachedBinaryAssets = new Map<string, ArrayBuffer>();

async function finalizeRun(run: ActiveRun): Promise<void> {
  const tokenSummary = inferDesignTokens(run.pages.map((page) => page.snapshot));
  const manifest = createManifest({
    siteRootUrl: run.siteRootUrl,
    crawlStartUrl: run.startUrl,
    startedAt: run.startedAt,
    completedAt: new Date().toISOString(),
    pages: run.pages,
    failures: run.failures,
    tokenSummary
  });

  try {
    const downloadId = await buildAndDownloadZip({
      run,
      manifest,
      tokenSummary,
      includeBinaryAssets: true,
      includeScreenshots: true,
      suffix: ""
    });

    updateProgress({
      status: run.cancelled ? "cancelled" : "completed",
      message: run.cancelled ? "Cancelled. Partial export downloaded." : "Export completed.",
      downloadId,
      currentUrl: undefined,
      completedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString()
    });
    recordEvent(run.cancelled ? "warning" : "info", run.cancelled ? "Partial export downloaded." : "Export completed.");
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    recordEvent("warning", `Full export failed, attempting fallback export: ${reason}`);
    updateProgress({
      status: "running",
      message: "Full export failed. Building fallback bundle...",
      error: reason,
      lastHeartbeat: new Date().toISOString()
    });

    const fallbackDownloadId = await buildAndDownloadZip({
      run,
      manifest,
      tokenSummary,
      includeBinaryAssets: false,
      includeScreenshots: false,
      suffix: "-partial"
    });

    updateProgress({
      status: run.cancelled ? "cancelled" : "completed",
      message: "Fallback export completed with reduced contents.",
      downloadId: fallbackDownloadId,
      currentUrl: undefined,
      completedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString()
    });
    recordEvent("warning", "Fallback export downloaded without screenshots or binary assets.");
  } finally {
    cachedBinaryAssets.clear();
  }
}

function buildReplicationPrompt(input: {
  startUrl: string;
  pageCount: number;
  tokenSummary: ReturnType<typeof inferDesignTokens>;
}): string {
  return [
    "# Replicate This Design Language",
    "",
    `Start URL: ${input.startUrl}`,
    `Captured pages: ${input.pageCount}`,
    "",
    "Use the files in `pages/` for structure and screenshots, `assets/` for referenced media and fonts, and `design-tokens.json` for repeated visual primitives.",
    "",
    "Priority order for reconstruction:",
    "1. Match layout, spacing, typography, color, and motion from `computed.css` and screenshots.",
    "2. Reuse recurring values from `design-tokens.json` to define a coherent design system.",
    "3. Consult `manifest.json` for crawl relationships, blocked assets, and page-level notes.",
    "",
    "Top token candidates:",
    JSON.stringify(input.tokenSummary, null, 2)
  ].join("\n");
}

async function buildAndDownloadZip(input: {
  run: ActiveRun;
  manifest: ReturnType<typeof createManifest>;
  tokenSummary: ReturnType<typeof inferDesignTokens>;
  includeBinaryAssets: boolean;
  includeScreenshots: boolean;
  suffix: string;
}): Promise<number> {
  const zip = new JSZip();
  const pages = input.run.pages as Array<
    typeof input.run.pages[number] & {
      viewportDataUrl?: string;
      fullPageDataUrl?: string;
    }
  >;

  for (const page of pages) {
    zip.file(page.files.domHtml, page.snapshot.domHtml);
    zip.file(page.files.computedCss, page.snapshot.computedCss);
    zip.file(page.files.animations, JSON.stringify(page.snapshot.animations, null, 2));
    zip.file(`pages/${page.id}/stylesheets.json`, JSON.stringify(page.snapshot.stylesheetRules, null, 2));
    zip.file(`pages/${page.id}/fonts.json`, JSON.stringify(page.snapshot.fonts, null, 2));
    zip.file(`pages/${page.id}/inline-scripts.json`, JSON.stringify(page.snapshot.inlineScripts, null, 2));

    if (input.includeScreenshots && page.viewportDataUrl) {
      zip.file(page.files.viewportScreenshot, dataUrlToUint8(page.viewportDataUrl), { binary: true });
    }
    if (input.includeScreenshots && page.fullPageDataUrl && page.files.fullPageScreenshot) {
      zip.file(page.files.fullPageScreenshot, dataUrlToUint8(page.fullPageDataUrl), { binary: true });
    }
  }

  if (input.includeBinaryAssets) {
    for (const [path, bytes] of cachedBinaryAssets.entries()) {
      zip.file(path, bytes);
    }
  }

  zip.file("manifest.json", JSON.stringify(input.manifest, null, 2));
  zip.file("design-tokens.json", JSON.stringify(input.tokenSummary, null, 2));
  zip.file(
    "prompts/replicate.md",
    buildReplicationPrompt({
      startUrl: input.run.startUrl,
      pageCount: input.run.pages.length,
      tokenSummary: input.tokenSummary
    })
  );
  zip.file(
    "README.md",
    `# Design Corpus Export\n\nGenerated by Design Corpus Exporter ${EXPORT_VERSION}.\n\nThis bundle contains runtime HTML snapshots, computed CSS, screenshots, extracted assets, and token summaries.\n`
  );

  const base64 = await zip.generateAsync({ type: "base64" });
  return await chrome.downloads.download({
    url: `data:application/zip;base64,${base64}`,
    saveAs: true,
    filename: `design-corpus-${Date.now()}${input.suffix}.zip`
  });
}

function updateProgress(patch: Partial<ProgressState>): void {
  progress = { ...progress, ...patch };
  void chrome.storage.local.set({ progress });
}

function recordEvent(level: "info" | "warning" | "error", message: string): void {
  const entry = { at: new Date().toISOString(), level, message };
  const recentEvents = [...progress.recentEvents, entry].slice(-60);
  progress = {
    ...progress,
    recentEvents,
    warnings: recentEvents.filter((event) => event.level === "warning").length,
    failures: recentEvents.filter((event) => event.level === "error").length,
    lastHeartbeat: entry.at
  };
  void chrome.storage.local.set({ progress });
}

function recordWarning(message: string): void {
  recordEvent("warning", message);
}

function recordFailure(url: string, stage: string, reason: string): void {
  activeRun?.failures.push({ url, stage, reason });
  recordEvent("error", `${stage} failed for ${url}: ${reason}`);
  updateProgress({
    status: activeRun?.cancelled ? "cancelled" : "running",
    message: `Issue on ${url}`,
    error: reason
  });
}

async function sendScrapeMessage(tabId: number) {
  try {
    return await withTimeout(
      chrome.tabs.sendMessage(tabId, { type: "SCRAPE_PAGE", payload: activeRun!.settings }),
      PAGE_TIMEOUT_MS,
      "Timed out waiting for page scrape."
    );
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return await withTimeout(
      chrome.tabs.sendMessage(tabId, { type: "SCRAPE_PAGE", payload: activeRun!.settings }),
      PAGE_TIMEOUT_MS,
      "Timed out waiting for injected content script."
    );
  }
}

async function openStatusPage(runId: string | null): Promise<void> {
  const statusUrl = chrome.runtime.getURL(`status.html${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`);
  const tabs = await chrome.tabs.query({ url: `${chrome.runtime.getURL("status.html")}*` });
  const existing = tabs[0];
  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: statusUrl });
    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: statusUrl, active: true });
}

async function recoverStaleRun(): Promise<void> {
  const stored = (await chrome.storage.local.get(["progress"])).progress as ProgressState | undefined;
  if (stored?.status === "running") {
    progress = {
      ...stored,
      status: "error",
      message: "The browser worker restarted. The previous run was interrupted.",
      completedAt: new Date().toISOString(),
      error: "Service worker restarted during export.",
      recentEvents: [
        ...stored.recentEvents,
        {
          at: new Date().toISOString(),
          level: "error",
          message: "Recovered stale running state after a service worker restart."
        }
      ].slice(-60)
    };
    await chrome.storage.local.set({ progress });
  }
}

function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function dataUrlToUint8(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
