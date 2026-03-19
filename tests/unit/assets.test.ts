import { describe, expect, it } from "vitest";
import { assetPathForUrl, inferAssetType } from "../../src/shared/assets";

describe("inferAssetType", () => {
  it("classifies fonts and stylesheets", () => {
    expect(inferAssetType("https://example.com/fonts/site.woff2")).toBe("font");
    expect(inferAssetType("https://example.com/styles/app.css")).toBe("stylesheet");
  });
});

describe("assetPathForUrl", () => {
  it("creates deterministic paths", () => {
    expect(assetPathForUrl("https://example.com/images/hero banner.png")).toBe("assets/image/hero-banner.png");
  });
});
