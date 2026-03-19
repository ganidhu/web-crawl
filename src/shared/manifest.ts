import { EXPORT_VERSION } from "./constants";
import type { AssetRecord, DesignTokens, ExportManifest, PageSnapshot } from "./types";

export function createManifest(input: {
  siteRootUrl: string;
  crawlStartUrl: string;
  startedAt: string;
  completedAt: string;
  pages: Array<{
    id: string;
    depth: number;
    snapshot: PageSnapshot;
    files: Record<string, string>;
  }>;
  failures: Array<{ url: string; stage: string; reason: string }>;
  tokenSummary: DesignTokens;
}): ExportManifest {
  const blockedAssets: AssetRecord[] = [];
  let captured = 0;
  let skipped = 0;

  for (const page of input.pages) {
    for (const asset of page.snapshot.assets) {
      if (asset.status === "blocked") blockedAssets.push(asset);
      if (asset.status === "captured") captured += 1;
      if (asset.status === "skipped") skipped += 1;
    }
  }

  return {
    exportVersion: EXPORT_VERSION,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    siteRootUrl: input.siteRootUrl,
    crawlStartUrl: input.crawlStartUrl,
    pages: input.pages.map(({ id, depth, snapshot, files }) => ({
      id,
      url: snapshot.url,
      title: snapshot.title,
      depth,
      discoveredLinks: snapshot.links.map((link) => link.url),
      files,
      blockedAssets: snapshot.assets.filter((asset) => asset.status === "blocked"),
      capturedAssets: snapshot.assets.filter((asset) => asset.status === "captured").length,
      extractionTime: snapshot.extractionTime,
      notes: snapshot.notes
    })),
    assetSummary: {
      captured,
      blocked: blockedAssets.length,
      skipped
    },
    failures: input.failures,
    tokenSummary: input.tokenSummary
  };
}
