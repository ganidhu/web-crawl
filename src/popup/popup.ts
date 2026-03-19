import { DEFAULT_PROGRESS, DEFAULT_SETTINGS } from "../shared/constants";
import type { ExportSettings, ProgressState } from "../shared/types";

const form = document.querySelector<HTMLFormElement>("#export-form");
const statusLine = document.querySelector<HTMLDivElement>("#status-line");
const progressBar = document.querySelector<HTMLProgressElement>("#progress");
const summary = document.querySelector<HTMLPreElement>("#summary");
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel-button");
const statusButton = document.querySelector<HTMLButtonElement>("#status-button");

void init();

async function init(): Promise<void> {
  if (!form || !statusLine || !progressBar || !summary || !cancelButton || !statusButton) return;

  const { exportSettings = DEFAULT_SETTINGS, progress = DEFAULT_PROGRESS } = await chrome.storage.local.get([
    "exportSettings",
    "progress"
  ]);
  hydrateForm(exportSettings as ExportSettings);
  renderProgress(progress as ProgressState);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = readForm();
    await chrome.runtime.sendMessage({ type: "START_EXPORT", payload: settings });
  });

  cancelButton.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CANCEL_EXPORT" });
  });

  statusButton.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "OPEN_STATUS_PAGE" });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.progress?.newValue) {
      renderProgress(changes.progress.newValue as ProgressState);
    }
  });
}

function hydrateForm(settings: ExportSettings): void {
  for (const key of Object.keys(settings) as Array<keyof ExportSettings>) {
    const field = form!.elements.namedItem(key);
    if (field instanceof HTMLInputElement && field.type === "checkbox") {
      field.checked = Boolean(settings[key]);
    } else if (field instanceof HTMLInputElement) {
      field.value = String(settings[key]);
    } else if (field instanceof HTMLSelectElement) {
      field.value = String(settings[key]);
    }
  }
}

function readForm(): ExportSettings {
  const data = new FormData(form!);
  return {
    scope: (data.get("scope") as ExportSettings["scope"]) ?? DEFAULT_SETTINGS.scope,
    maxDepth: Number(data.get("maxDepth") ?? DEFAULT_SETTINGS.maxDepth),
    maxPages: Number(data.get("maxPages") ?? DEFAULT_SETTINGS.maxPages),
    maxAssetsPerPage: Number(data.get("maxAssetsPerPage") ?? DEFAULT_SETTINGS.maxAssetsPerPage),
    screenshotMode: (data.get("screenshotMode") as ExportSettings["screenshotMode"]) ?? DEFAULT_SETTINGS.screenshotMode,
    autoScroll: data.get("autoScroll") === "on",
    captureThirdParty: data.get("captureThirdParty") === "on"
  };
}

function renderProgress(progress: ProgressState): void {
  if (!statusLine || !progressBar || !summary) return;
  statusLine.textContent = progress.message;
  const total = Math.max(progress.pagesQueued, progress.pagesProcessed, 1);
  progressBar.max = total;
  progressBar.value = progress.pagesProcessed;
  summary.textContent = JSON.stringify(
    {
      status: progress.status,
      currentUrl: progress.currentUrl,
      pagesProcessed: progress.pagesProcessed,
      pagesQueued: progress.pagesQueued,
      assetsCaptured: progress.assetsCaptured,
      assetsBlocked: progress.assetsBlocked,
      failures: progress.failures,
      warnings: progress.warnings,
      startedAt: progress.startedAt,
      completedAt: progress.completedAt,
      downloadId: progress.downloadId,
      error: progress.error
    },
    null,
    2
  );
}
