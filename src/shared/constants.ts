import type { ExportSettings, ProgressState } from "./types";

export const EXPORT_VERSION = "0.1.0";

export const DEFAULT_SETTINGS: ExportSettings = {
  scope: "origin",
  maxDepth: 2,
  maxPages: 12,
  maxAssetsPerPage: 120,
  screenshotMode: "viewport",
  autoScroll: true,
  captureThirdParty: true
};

export const DEFAULT_PROGRESS: ProgressState = {
  runId: null,
  status: "idle",
  message: "Idle.",
  pagesQueued: 0,
  pagesProcessed: 0,
  assetsCaptured: 0,
  assetsBlocked: 0
};
