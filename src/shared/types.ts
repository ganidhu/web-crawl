export type CrawlScope = "origin" | "path";
export type ScreenshotMode = "viewport" | "full";

export interface ExportSettings {
  scope: CrawlScope;
  maxDepth: number;
  maxPages: number;
  maxAssetsPerPage: number;
  screenshotMode: ScreenshotMode;
  autoScroll: boolean;
  captureThirdParty: boolean;
}

export interface LinkRecord {
  url: string;
  text: string;
}

export interface AssetRecord {
  url: string;
  type: string;
  source: string;
  mimeType?: string;
  status: "captured" | "blocked" | "skipped";
  path?: string;
  reason?: string;
}

export interface AnimationRecord {
  target: string;
  name: string;
  durationMs: number;
  delayMs: number;
  easing: string;
  iterations: string;
  direction: string;
  fill: string;
}

export interface TokenCandidate {
  value: string;
  count: number;
}

export interface DesignTokens {
  colors: TokenCandidate[];
  typography: TokenCandidate[];
  spacing: TokenCandidate[];
  radii: TokenCandidate[];
  shadows: TokenCandidate[];
  motion: TokenCandidate[];
  breakpoints: TokenCandidate[];
}

export interface PageSnapshot {
  url: string;
  title: string;
  domHtml: string;
  computedCss: string;
  links: LinkRecord[];
  assets: AssetRecord[];
  inlineScripts: string[];
  stylesheetRules: string[];
  fonts: string[];
  animations: AnimationRecord[];
  viewport: {
    width: number;
    height: number;
    fullHeight: number;
  };
  extractionTime: string;
  notes: string[];
}

export interface PageExportRecord {
  id: string;
  url: string;
  title: string;
  depth: number;
  discoveredLinks: string[];
  files: Record<string, string>;
  blockedAssets: AssetRecord[];
  capturedAssets: number;
  extractionTime: string;
  notes: string[];
}

export interface ExportManifest {
  exportVersion: string;
  startedAt: string;
  completedAt: string;
  siteRootUrl: string;
  crawlStartUrl: string;
  pages: PageExportRecord[];
  assetSummary: {
    captured: number;
    blocked: number;
    skipped: number;
  };
  failures: Array<{
    url: string;
    stage: string;
    reason: string;
  }>;
  tokenSummary: DesignTokens;
}

export interface ProgressState {
  runId: string | null;
  status: "idle" | "running" | "completed" | "cancelled" | "error";
  message: string;
  pagesQueued: number;
  pagesProcessed: number;
  assetsCaptured: number;
  assetsBlocked: number;
  failures: number;
  warnings: number;
  currentUrl?: string;
  downloadId?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  lastHeartbeat?: string;
  settings?: ExportSettings;
  recentEvents: Array<{
    at: string;
    level: "info" | "warning" | "error";
    message: string;
  }>;
}

export type RuntimeMessage =
  | { type: "START_EXPORT"; payload: ExportSettings }
  | { type: "CANCEL_EXPORT" }
  | { type: "GET_PROGRESS" }
  | { type: "OPEN_STATUS_PAGE"; payload?: { runId?: string | null } }
  | { type: "SCRAPE_PAGE"; payload: ExportSettings };
