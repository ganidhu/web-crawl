import { DEFAULT_PROGRESS, DEFAULT_SETTINGS } from "../shared/constants";
import type { ExportSettings, FailedCrawlRecord, ProgressState } from "../shared/types";

const statusLine = document.querySelector<HTMLDivElement>("#status-line");
const statusShell = document.querySelector<HTMLDivElement>("#status-shell");
const statusPhase = document.querySelector<HTMLDivElement>("#status-phase");
const runMeta = document.querySelector<HTMLDivElement>("#run-meta");
const downloadPath = document.querySelector<HTMLDivElement>("#download-path");
const currentTargetLabel = document.querySelector<HTMLDivElement>("#current-target-label");
const currentUrl = document.querySelector<HTMLDivElement>("#current-url");
const progressBar = document.querySelector<HTMLProgressElement>("#progress");
const progressPercent = document.querySelector<HTMLSpanElement>("#progress-percent");
const sessionStarted = document.querySelector<HTMLDivElement>("#session-started");
const estimatedRemaining = document.querySelector<HTMLDivElement>("#estimated-remaining");
const pagesProcessed = document.querySelector<HTMLDivElement>("#pages-processed");
const pagesQueued = document.querySelector<HTMLDivElement>("#pages-queued");
const assetsCaptured = document.querySelector<HTMLDivElement>("#assets-captured");
const assetsBlocked = document.querySelector<HTMLDivElement>("#assets-blocked");
const failures = document.querySelector<HTMLDivElement>("#failures");
const warnings = document.querySelector<HTMLDivElement>("#warnings");
const settings = document.querySelector<HTMLPreElement>("#settings");
const events = document.querySelector<HTMLDivElement>("#events");
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel-button");
const finishButton = document.querySelector<HTMLButtonElement>("#finish-button");
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-button");
const downloadButton = document.querySelector<HTMLButtonElement>("#download-button");
const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
const openNewCrawlButton = document.querySelector<HTMLButtonElement>("#open-new-crawl-button");
const closeNewCrawlButton = document.querySelector<HTMLButtonElement>("#close-new-crawl-button");
const cancelNewCrawlButton = document.querySelector<HTMLButtonElement>("#cancel-new-crawl-button");
const newCrawlModal = document.querySelector<HTMLDivElement>("#new-crawl-modal");
const newCrawlBackdrop = document.querySelector<HTMLDivElement>("#new-crawl-backdrop");
const newCrawlForm = document.querySelector<HTMLFormElement>("#new-crawl-form");
const openSettingsButton = document.querySelector<HTMLButtonElement>("#open-settings-button");
const closeSettingsButton = document.querySelector<HTMLButtonElement>("#close-settings-button");
const settingsModal = document.querySelector<HTMLDivElement>("#settings-modal");
const settingsBackdrop = document.querySelector<HTMLDivElement>("#settings-backdrop");
const openFailedCrawlsButton = document.querySelector<HTMLButtonElement>("#open-failed-crawls-button");
const closeFailedCrawlsButton = document.querySelector<HTMLButtonElement>("#close-failed-crawls-button");
const failedCrawlsModal = document.querySelector<HTMLDivElement>("#failed-crawls-modal");
const failedCrawlsBackdrop = document.querySelector<HTMLDivElement>("#failed-crawls-backdrop");
const failedCrawlsList = document.querySelector<HTMLDivElement>("#failed-crawls-list");
const THEME_KEY = "statusTheme";
let lastStatusMessage = "";

void init();

async function init(): Promise<void> {
  try {
    await applyStoredTheme();
    await hydrateNewCrawlForm();
    await renderFromStorage();
    bindExclusiveTooltips(document);
  } catch (error) {
    console.error("Status page initialization failed", error);
  }

  cancelButton?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CANCEL_EXPORT" });
  });

  finishButton?.addEventListener("click", async () => {
    if (finishButton.disabled) return;
    const response = await chrome.runtime.sendMessage({ type: "END_EXPORT_EARLY" });
    if (!response?.ok) {
      finishButton.title = response?.error ?? "Unable to end early yet.";
    }
  });

  downloadButton?.addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "SHOW_DOWNLOADED_FILE" });
    if (!response?.ok) {
      downloadButton.title = response?.error ?? "Unable to show the downloaded export.";
    }
  });

  refreshButton?.addEventListener("click", async () => {
    await renderFromStorage();
  });

  openNewCrawlButton?.addEventListener("click", async () => {
    await hydrateNewCrawlForm();
    setNewCrawlModalOpen(true);
    focusAndSelectTargetUrl();
  });

  closeNewCrawlButton?.addEventListener("click", () => {
    setNewCrawlModalOpen(false);
  });

  cancelNewCrawlButton?.addEventListener("click", () => {
    setNewCrawlModalOpen(false);
  });

  newCrawlBackdrop?.addEventListener("click", () => {
    setNewCrawlModalOpen(false);
  });

  newCrawlForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = readNewCrawlForm();
    await chrome.runtime.sendMessage({ type: "START_EXPORT", payload: settings });
    setNewCrawlModalOpen(false);
  });

  openSettingsButton?.addEventListener("click", () => {
    setSettingsModalOpen(true);
  });

  closeSettingsButton?.addEventListener("click", () => {
    setSettingsModalOpen(false);
  });

  settingsBackdrop?.addEventListener("click", () => {
    setSettingsModalOpen(false);
  });

  openFailedCrawlsButton?.addEventListener("click", async () => {
    try {
      await renderFailedCrawls();
      setFailedCrawlsModalOpen(true);
    } catch (error) {
      console.error("Failed to open failed crawls", error);
    }
  });

  closeFailedCrawlsButton?.addEventListener("click", () => {
    setFailedCrawlsModalOpen(false);
  });

  failedCrawlsBackdrop?.addEventListener("click", () => {
    setFailedCrawlsModalOpen(false);
  });

  themeToggle?.addEventListener("click", async () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    await chrome.storage.local.set({ [THEME_KEY]: next });
    applyTheme(next);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.progress?.newValue) {
      renderProgress(changes.progress.newValue as ProgressState);
    }
    if (changes.failedCrawls?.newValue && !failedCrawlsModal?.hidden) {
      void renderFailedCrawls();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setSettingsModalOpen(false);
      setNewCrawlModalOpen(false);
      setFailedCrawlsModalOpen(false);
    }
  });
}

async function applyStoredTheme(): Promise<void> {
  const { [THEME_KEY]: theme = "light" } = await chrome.storage.local.get([THEME_KEY]);
  applyTheme(theme as string);
}

function applyTheme(theme: string): void {
  const resolved = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
  if (themeToggle) {
    themeToggle.setAttribute("title", resolved === "dark" ? "Switch to light mode" : "Switch to night mode");
    themeToggle.setAttribute("aria-pressed", String(resolved === "dark"));
    themeToggle.setAttribute("aria-label", resolved === "dark" ? "Switch to light mode" : "Switch to night mode");
  }
}

async function renderFromStorage(): Promise<void> {
  const { progress = DEFAULT_PROGRESS } = await chrome.storage.local.get(["progress"]);
  renderProgress(progress as ProgressState);
}

function renderProgress(progress: ProgressState): void {
  if (
    !statusLine ||
    !statusShell ||
    !statusPhase ||
    !runMeta ||
    !downloadPath ||
    !currentTargetLabel ||
    !currentUrl ||
    !progressBar ||
    !progressPercent ||
    !sessionStarted ||
    !estimatedRemaining ||
    !pagesProcessed ||
    !pagesQueued ||
    !assetsCaptured ||
    !assetsBlocked ||
    !failures ||
    !warnings ||
    !settings ||
    !events
  ) {
    return;
  }

  const completionRatio = progress.pagesProcessed / Math.max(progress.pagesQueued, 1);
  const remainingEstimate = estimateRemaining(progress, completionRatio);
  const phase = resolveStatusPhase(progress, remainingEstimate);
  if (progress.message !== lastStatusMessage) {
    statusShell.classList.remove("morphing");
    void statusShell.offsetWidth;
    statusShell.classList.add("morphing");
    window.setTimeout(() => statusShell.classList.remove("morphing"), 560);
    lastStatusMessage = progress.message;
  }

  statusShell.dataset.phase = phase;
  statusPhase.textContent = phaseLabelFor(phase);
  statusLine.textContent = formatStatusMessage(progress, phase);
  renderCurrentTargets(progress);
  const total = Math.max(progress.pagesQueued, progress.pagesProcessed, 1);
  progressBar.max = total;
  progressBar.value = progress.pagesProcessed;
  progressPercent.textContent = `${Math.max(0, Math.min(100, Math.round(completionRatio * 100)))}%`;
  sessionStarted.textContent = progress.startedAt ? formatSessionStarted(progress.startedAt) : "--";
  estimatedRemaining.textContent = remainingEstimate;
  pagesProcessed.textContent = String(progress.pagesProcessed);
  pagesQueued.textContent = String(progress.pagesQueued);
  assetsCaptured.textContent = String(progress.assetsCaptured);
  assetsBlocked.textContent = String(progress.assetsBlocked);
  failures.textContent = String(progress.failures);
  warnings.textContent = String(progress.warnings);

  runMeta.textContent = [
    progress.runId ? `run ${progress.runId}` : "no active run",
    progress.startedAt ? `started ${new Date(progress.startedAt).toLocaleString()}` : null,
    progress.completedAt ? `completed ${new Date(progress.completedAt).toLocaleString()}` : null,
    progress.lastHeartbeat ? `heartbeat ${new Date(progress.lastHeartbeat).toLocaleTimeString()}` : null
  ]
    .filter(Boolean)
    .join("  |  ");

  settings.textContent = JSON.stringify(progress.settings ?? {}, null, 2);
  const completedRatio = progress.pagesProcessed / Math.max(progress.pagesQueued, progress.pagesProcessed, 1);
  const finishedEarly = progress.message.toLowerCase().includes("ended early");
  const fullyCompleted = progress.status === "completed" && completedRatio >= 1;
  const isDownloadReady = Boolean(progress.downloadId) && (finishedEarly || fullyCompleted);
  if (downloadButton) {
    downloadButton.hidden = !isDownloadReady;
  }
  downloadPath.hidden = !progress.downloadPath;
  downloadPath.textContent = progress.downloadPath ? `Saved to ${progress.downloadPath}` : "";
  if (cancelButton) {
    const canCancel = progress.status === "running";
    cancelButton.disabled = !canCancel;
    cancelButton.title = canCancel ? "Cancel after the current in-flight page finishes." : "No export is currently running.";
  }
  if (finishButton) {
    const canEndEarly = progress.status === "running" && completionRatio >= 0.25;
    finishButton.disabled = !canEndEarly;
    finishButton.title = canEndEarly
      ? "Stop after the current page and export what has already been captured."
      : "Available after the export passes 25% progress.";
  }
  events.replaceChildren();
  for (const event of progress.recentEvents.slice().reverse()) {
    const row = document.createElement("div");
    row.className = `event-line ${event.level}`;
    row.textContent = `[${new Date(event.at).toLocaleTimeString()}] ${event.level.toUpperCase()}  ${event.message}`;
    events.appendChild(row);
  }
}

function renderCurrentTargets(progress: ProgressState): void {
  if (!currentUrl || !currentTargetLabel) return;

  const urls = (progress.currentUrls ?? []).filter(Boolean);
  currentTargetLabel.textContent = urls.length > 1 ? "Current Targets" : "Current Target";
  currentUrl.replaceChildren();

  if (urls.length === 0) {
    currentUrl.textContent = progress.currentUrl ?? "None";
    return;
  }

  for (const url of urls.slice(0, 3)) {
    const line = document.createElement("span");
    line.className = "target-url-line";
    line.textContent = url;
    currentUrl.appendChild(line);
  }
}

function formatSessionStarted(startedAt: string): string {
  const start = new Date(startedAt);
  const time = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const zone = formatTimeZone(start);
  return zone ? `${time} ${zone}` : time;
}

function estimateRemaining(progress: ProgressState, completionRatio: number): string {
  if (progress.status !== "running") {
    return progress.status === "completed" ? "0s" : "--";
  }

  if (!progress.startedAt || progress.pagesProcessed <= 0 || completionRatio <= 0) {
    return "--";
  }

  const elapsedMs = Date.now() - new Date(progress.startedAt).getTime();
  if (elapsedMs <= 0) return "--";

  const totalUnits = Math.max(progress.pagesQueued, progress.pagesProcessed, 1);
  const perUnitMs = elapsedMs / Math.max(progress.pagesProcessed, 1);
  const remainingUnits = Math.max(0, totalUnits - progress.pagesProcessed);
  const remainingMs = remainingUnits * perUnitMs;
  return `~ ${formatDuration(remainingMs)}`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatTimeZone(date: Date): string {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "shortOffset" }).formatToParts(date);
  const zone = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  return zone.replace("GMT", "GMT");
}

function setSettingsModalOpen(isOpen: boolean): void {
  if (!settingsModal) return;
  settingsModal.hidden = !isOpen;
}

function setNewCrawlModalOpen(isOpen: boolean): void {
  if (!newCrawlModal) return;
  newCrawlModal.hidden = !isOpen;
}

function setFailedCrawlsModalOpen(isOpen: boolean): void {
  if (!failedCrawlsModal) return;
  failedCrawlsModal.hidden = !isOpen;
}

async function hydrateNewCrawlForm(): Promise<void> {
  if (!newCrawlForm) return;
  const [{ exportSettings = DEFAULT_SETTINGS }, suggestedUrl] = await Promise.all([
    chrome.storage.local.get(["exportSettings"]),
    getSuggestedTargetUrl()
  ]);

  const settings = exportSettings as ExportSettings;
  const targetUrlField = newCrawlForm.elements.namedItem("targetUrl");
  if (targetUrlField instanceof HTMLInputElement) {
    targetUrlField.value = suggestedUrl ?? settings.targetUrl ?? "";
  }

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ExportSettings>) {
    const field = newCrawlForm.elements.namedItem(key);
    const value = settings[key] ?? DEFAULT_SETTINGS[key];
    if (field instanceof HTMLInputElement && field.type === "checkbox") {
      field.checked = Boolean(value);
    } else if (field instanceof HTMLInputElement) {
      field.value = String(value);
    } else if (field instanceof HTMLSelectElement) {
      field.value = String(value);
    }
  }
}

async function getSuggestedTargetUrl(): Promise<string | undefined> {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const extensionOrigin = chrome.runtime.getURL("");
  const candidates = tabs
    .filter((tab) => typeof tab.url === "string" && !tab.url.startsWith(extensionOrigin))
    .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0));
  return candidates[0]?.url;
}

function focusAndSelectTargetUrl(): void {
  const targetUrlField = newCrawlForm?.elements.namedItem("targetUrl");
  if (!(targetUrlField instanceof HTMLInputElement)) return;
  window.setTimeout(() => {
    targetUrlField.focus();
    targetUrlField.select();
  }, 40);
}

function readNewCrawlForm(): ExportSettings {
  if (!newCrawlForm) {
    return { ...DEFAULT_SETTINGS };
  }

  const data = new FormData(newCrawlForm);
  return {
    scope: (data.get("scope") as ExportSettings["scope"]) ?? DEFAULT_SETTINGS.scope,
    maxDepth: Number(data.get("maxDepth") ?? DEFAULT_SETTINGS.maxDepth),
    maxPages: Number(data.get("maxPages") ?? DEFAULT_SETTINGS.maxPages),
    maxAssetsPerPage: Number(data.get("maxAssetsPerPage") ?? DEFAULT_SETTINGS.maxAssetsPerPage),
    screenshotMode: (data.get("screenshotMode") as ExportSettings["screenshotMode"]) ?? DEFAULT_SETTINGS.screenshotMode,
    autoScroll: data.get("autoScroll") === "on",
    captureThirdParty: data.get("captureThirdParty") === "on",
    targetUrl: String(data.get("targetUrl") ?? "").trim() || undefined
  };
}

async function renderFailedCrawls(): Promise<void> {
  if (!failedCrawlsList) return;
  const { failedCrawls = [] } = await chrome.storage.local.get(["failedCrawls"]);
  const entries = failedCrawls as FailedCrawlRecord[];
  failedCrawlsList.replaceChildren();

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "failed-crawl-empty";
    empty.textContent = "No failed or partial crawls to recover right now.";
    failedCrawlsList.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "failed-crawl-card";

    const row = document.createElement("div");
    row.className = "failed-crawl-row";

    const copy = document.createElement("div");
    const name = document.createElement("h3");
    name.className = "failed-crawl-name";
    name.textContent = entry.name;
    const url = document.createElement("div");
    url.className = "failed-crawl-url";
    url.textContent = entry.url;
    copy.append(name, url);

    row.append(copy);

    if (entry.downloadId) {
      const button = document.createElement("button");
      button.className = "ghost failed-crawl-download";
      button.type = "button";
      button.textContent = "Download";
      button.addEventListener("click", async () => {
        await chrome.runtime.sendMessage({ type: "SHOW_DOWNLOAD_BY_ID", payload: { downloadId: entry.downloadId! } });
      });
      row.append(button);
    }

    const grid = document.createElement("div");
    grid.className = "failed-crawl-grid";
    grid.append(
      createFailedCrawlMeta("Session Time", formatSessionTime(entry.startedAt)),
      createFailedCrawlMeta("Session Status", failedStatusLabel(entry.status)),
      createFailedCrawlMeta("Failed At", `${entry.percentAtStop}%`)
    );

    card.append(row, grid);
    failedCrawlsList.appendChild(card);
  }
}

function createFailedCrawlMeta(label: string, value: string): HTMLDivElement {
  const block = document.createElement("div");
  block.className = "failed-crawl-meta";
  const title = document.createElement("div");
  title.className = "failed-crawl-meta-label";
  title.textContent = label;
  const text = document.createElement("div");
  text.className = "failed-crawl-meta-value";
  text.textContent = value;
  block.append(title, text);
  return block;
}

function formatSessionTime(startedAt: string): string {
  const date = new Date(startedAt);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function failedStatusLabel(status: FailedCrawlRecord["status"]): string {
  switch (status) {
    case "ended-early":
      return "Ended Early";
    case "fallback":
      return "Partial Export";
    default:
      return "Cancelled";
  }
}

function bindExclusiveTooltips(root: ParentNode): void {
  const fields = Array.from(root.querySelectorAll<HTMLElement>(".crawl-field[data-tooltip]"));
  let activeField: HTMLElement | null = null;

  const setActive = (field: HTMLElement | null) => {
    if (activeField && activeField !== field) {
      activeField.classList.remove("tooltip-active");
    }
    activeField = field;
    if (activeField) {
      activeField.classList.add("tooltip-active");
    }
  };

  for (const field of fields) {
    field.addEventListener("mouseenter", () => {
      setActive(field);
    });
    field.addEventListener("mouseleave", () => {
      if (activeField === field) {
        field.classList.remove("tooltip-active");
        activeField = null;
      }
    });
    field.addEventListener("focusin", () => {
      setActive(field);
    });
    field.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (!field.contains(document.activeElement) && activeField === field) {
          field.classList.remove("tooltip-active");
          activeField = null;
        }
      }, 0);
    });
  }
}

function formatStatusMessage(progress: ProgressState, phase: string): string {
  if (phase === "capturing") {
    return "Capturing";
  }

  if (phase === "exporting") {
    return "Exporting";
  }

  if (phase === "complete") {
    return "Export Complete";
  }

  if (phase === "ending") {
    return progress.status === "cancelled" ? "Export Ended Early" : "Wrapping Up";
  }

  if (phase === "error") {
    return "Export Failed";
  }

  return progress.message;
}

function resolveStatusPhase(progress: ProgressState, remainingEstimate: string): string {
  const message = progress.message.toLowerCase();
  if (progress.status === "idle") return "idle";
  if (progress.status === "error") return "error";
  if (progress.status === "cancelled") return "ending";
  if (progress.status === "completed") return "complete";
  if (progress.status === "running" && remainingEstimate === "--") return "thinking";
  if (message.includes("thinking") || message.includes("preparing")) return "thinking";
  if (message.includes("capturing")) return "capturing";
  if (message.includes("export")) return "exporting";
  if (message.includes("ending")) return "ending";
  return "active";
}

function phaseLabelFor(phase: string): string {
  switch (phase) {
    case "thinking":
      return "Thinking";
    case "capturing":
      return "Capturing";
    case "exporting":
      return "Exporting";
    case "ending":
      return "Ending";
    case "complete":
      return "Complete";
    case "error":
      return "Attention";
    case "active":
      return "Running";
    default:
      return "Standby";
  }
}
