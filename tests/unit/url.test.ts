import { describe, expect, it } from "vitest";
import { normalizeUrl, shouldVisitUrl } from "../../src/shared/url";

describe("normalizeUrl", () => {
  it("drops hash and sorts query params", () => {
    expect(normalizeUrl("https://example.com/path/?b=2&a=1#hero")).toBe("https://example.com/path?a=1&b=2");
  });
});

describe("shouldVisitUrl", () => {
  it("accepts same-origin pages in origin scope", () => {
    expect(shouldVisitUrl("https://example.com/docs/page", "https://example.com/start", "origin")).toBe(true);
  });

  it("rejects cross-origin pages", () => {
    expect(shouldVisitUrl("https://cdn.example.com/docs/page", "https://example.com/start", "origin")).toBe(false);
  });

  it("restricts path scope", () => {
    expect(shouldVisitUrl("https://example.com/docs/page", "https://example.com/docs", "path")).toBe(true);
    expect(shouldVisitUrl("https://example.com/blog/post", "https://example.com/docs", "path")).toBe(false);
  });
});
