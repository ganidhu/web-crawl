import { describe, expect, it } from "vitest";
import { createManifest } from "../../src/shared/manifest";
import type { PageSnapshot } from "../../src/shared/types";

const snapshot: PageSnapshot = {
  url: "https://example.com",
  title: "Example",
  domHtml: "<html></html>",
  computedCss: "",
  links: [],
  assets: [
    { url: "https://example.com/a.css", type: "stylesheet", source: "link", status: "captured", path: "assets/stylesheet/a.css" },
    { url: "https://cdn.example.com/b.css", type: "stylesheet", source: "link", status: "blocked", reason: "403" }
  ],
  inlineScripts: [],
  stylesheetRules: [],
  fonts: [],
  animations: [],
  viewport: { width: 100, height: 100, fullHeight: 100 },
  extractionTime: "2026-03-19T00:00:00.000Z",
  notes: []
};

describe("createManifest", () => {
  it("summarizes captured and blocked assets", () => {
    const manifest = createManifest({
      siteRootUrl: "https://example.com",
      crawlStartUrl: "https://example.com",
      startedAt: "2026-03-19T00:00:00.000Z",
      completedAt: "2026-03-19T00:05:00.000Z",
      pages: [{ id: "001-home", depth: 0, snapshot, files: { domHtml: "pages/001-home/dom.html" } }],
      failures: [],
      tokenSummary: {
        colors: [],
        typography: [],
        spacing: [],
        radii: [],
        shadows: [],
        motion: [],
        breakpoints: []
      }
    });

    expect(manifest.assetSummary.captured).toBe(1);
    expect(manifest.assetSummary.blocked).toBe(1);
    expect(manifest.pages[0].blockedAssets).toHaveLength(1);
  });
});
