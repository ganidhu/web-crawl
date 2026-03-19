import { describe, expect, it } from "vitest";
import { inferDesignTokens } from "../../src/shared/tokens";
import type { PageSnapshot } from "../../src/shared/types";

describe("inferDesignTokens", () => {
  it("aggregates repeated values from CSS and animations", () => {
    const page = {
      url: "https://example.com",
      title: "Example",
      domHtml: "",
      computedCss: `
[data-design-export-id="0"] {
  color: rgb(0, 0, 0);
  font-family: Inter;
  padding: 16px;
  border-radius: 12px;
  box-shadow: rgba(0,0,0,0.2) 0 4px 8px;
}
      `,
      links: [],
      assets: [],
      inlineScripts: [],
      stylesheetRules: [],
      fonts: [],
      animations: [
        {
          target: "div",
          name: "fade-in",
          durationMs: 300,
          delayMs: 0,
          easing: "ease",
          iterations: "1",
          direction: "normal",
          fill: "both"
        }
      ],
      viewport: { width: 1440, height: 900, fullHeight: 1200 },
      extractionTime: "2026-03-19T00:00:00.000Z",
      notes: []
    } satisfies PageSnapshot;

    const tokens = inferDesignTokens([page]);
    expect(tokens.colors[0]?.value).toContain("rgb(0, 0, 0)");
    expect(tokens.typography[0]?.value).toContain("Inter");
    expect(tokens.motion[0]?.value).toContain("fade-in");
  });
});
