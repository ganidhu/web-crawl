import { DEFAULT_PROGRESS } from "../shared/constants";
import type { ProgressState } from "../shared/types";

const statusLine = document.querySelector<HTMLDivElement>("#status-line");
const runMeta = document.querySelector<HTMLDivElement>("#run-meta");
const currentUrl = document.querySelector<HTMLDivElement>("#current-url");
const progressBar = document.querySelector<HTMLProgressElement>("#progress");
const pagesProcessed = document.querySelector<HTMLDivElement>("#pages-processed");
const pagesQueued = document.querySelector<HTMLDivElement>("#pages-queued");
const assetsCaptured = document.querySelector<HTMLDivElement>("#assets-captured");
const assetsBlocked = document.querySelector<HTMLDivElement>("#assets-blocked");
const failures = document.querySelector<HTMLDivElement>("#failures");
const warnings = document.querySelector<HTMLDivElement>("#warnings");
const settings = document.querySelector<HTMLPreElement>("#settings");
const events = document.querySelector<HTMLDivElement>("#events");
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel-button");
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-button");

void init();

async function init(): Promise<void> {
  await renderFromStorage();

  cancelButton?.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CANCEL_EXPORT" });
  });

  refreshButton?.addEventListener("click", async () => {
    await renderFromStorage();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.progress?.newValue) return;
    renderProgress(changes.progress.newValue as ProgressState);
  });
}

async function renderFromStorage(): Promise<void> {
  const { progress = DEFAULT_PROGRESS } = await chrome.storage.local.get(["progress"]);
  renderProgress(progress as ProgressState);
}

function renderProgress(progress: ProgressState): void {
  if (
    !statusLine ||
    !runMeta ||
    !currentUrl ||
    !progressBar ||
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

  statusLine.textContent = progress.message;
  currentUrl.textContent = progress.currentUrl ?? "None";
  const total = Math.max(progress.pagesQueued, progress.pagesProcessed, 1);
  progressBar.max = total;
  progressBar.value = progress.pagesProcessed;
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
  events.replaceChildren();
  for (const event of progress.recentEvents.slice().reverse()) {
    const row = document.createElement("div");
    row.className = `event-line ${event.level}`;
    row.textContent = `[${new Date(event.at).toLocaleTimeString()}] ${event.level.toUpperCase()}  ${event.message}`;
    events.appendChild(row);
  }
}
