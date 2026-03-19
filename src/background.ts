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

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({ exportSettings: DEFAULT_SETTINGS, progress: DEFAULT_PROGRESS });
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "GET_PROGRESS") {
    sendResponse(progress);
    return;
  }

  if (message.type === "CANCEL_EXPORT") {
    if (activeRun) {
      activeRun.cancelled = true;
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
  updateProgress({
    runId,
    status: "running",
    message: "Crawling site...",
    pagesQueued: 1,
    pagesProcessed: 0,
    assetsCaptured: 0,
    assetsBlocked: 0,
    currentUrl: startUrl,
    error: undefined
  });

  try {
    while (activeRun && activeRun.queue.length > 0 && activeRun.pages.length < settings.maxPages) {
      if (activeRun.cancelled) break;
      const next = activeRun.queue.shift();
      if (!next) continue;
      if (activeRun.visited.has(next.url)) continue;
      activeRun.visited.add(next.url);
      updateProgress({ currentUrl: next.url, message: `Capturing ${next.url}` });
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
    return;
  }

  try {
    await waitForTabComplete(tab.id);
    await delay(900);
    const scrapeResponse = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PAGE", payload: activeRun.settings });
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
      message: `Captured ${snapshot.title || snapshot.url}`
    });

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
    activeRun.failures.push({
      url: job.url,
      stage: "capture",
      reason: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await chrome.tabs.remove(tab.id);
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
    const url = new URL(asset.url);
    if (!includeThirdParty && activeRun && url.origin !== activeRun.siteRootUrl) {
      results.push({ ...asset, status: "skipped", reason: "Third-party capture disabled." });
      continue;
    }
    try {
      const response = await fetch(asset.url, { credentials: "include" });
      if (!response.ok) {
        results.push({ ...asset, status: "blocked", reason: `HTTP ${response.status}` });
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
    }
  }
  return results;
}

const cachedBinaryAssets = new Map<string, ArrayBuffer>();

async function finalizeRun(run: ActiveRun): Promise<void> {
  const zip = new JSZip();
  const pages = run.pages as Array<
    typeof run.pages[number] & {
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
    if (page.viewportDataUrl) {
      zip.file(page.files.viewportScreenshot, dataUrlToUint8(page.viewportDataUrl), { binary: true });
    }
    if (page.fullPageDataUrl && page.files.fullPageScreenshot) {
      zip.file(page.files.fullPageScreenshot, dataUrlToUint8(page.fullPageDataUrl), { binary: true });
    }
  }

  for (const [path, bytes] of cachedBinaryAssets.entries()) {
    zip.file(path, bytes);
  }

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

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("design-tokens.json", JSON.stringify(tokenSummary, null, 2));
  zip.file(
    "prompts/replicate.md",
    buildReplicationPrompt({
      startUrl: run.startUrl,
      pageCount: run.pages.length,
      tokenSummary
    })
  );
  zip.file(
    "README.md",
    `# Design Corpus Export\n\nGenerated by Design Corpus Exporter ${EXPORT_VERSION}.\n\nThis bundle contains runtime HTML snapshots, computed CSS, screenshots, extracted assets, and token summaries.\n`
  );

  const blob = await zip.generateAsync({ type: "blob" });
  const objectUrl = URL.createObjectURL(blob);
  const downloadId = await chrome.downloads.download({
    url: objectUrl,
    saveAs: true,
    filename: `design-corpus-${Date.now()}.zip`
  });

  updateProgress({
    status: run.cancelled ? "cancelled" : "completed",
    message: run.cancelled ? "Cancelled. Partial export downloaded." : "Export completed.",
    downloadId,
    currentUrl: undefined
  });
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  cachedBinaryAssets.clear();
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

function updateProgress(patch: Partial<ProgressState>): void {
  progress = { ...progress, ...patch };
  void chrome.storage.local.set({ progress });
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
