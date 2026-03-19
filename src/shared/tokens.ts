import type { DesignTokens, PageSnapshot, TokenCandidate } from "./types";

function topEntries(values: Map<string, number>): TokenCandidate[] {
  return [...values.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([value, count]) => ({ value, count }));
}

function bump(map: Map<string, number>, value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none" || trimmed === "normal" || trimmed === "0px") return;
  map.set(trimmed, (map.get(trimmed) ?? 0) + 1);
}

export function inferDesignTokens(pages: PageSnapshot[]): DesignTokens {
  const colors = new Map<string, number>();
  const typography = new Map<string, number>();
  const spacing = new Map<string, number>();
  const radii = new Map<string, number>();
  const shadows = new Map<string, number>();
  const motion = new Map<string, number>();
  const breakpoints = new Map<string, number>();

  for (const page of pages) {
    bump(breakpoints, `${page.viewport.width}px`);
    for (const line of page.computedCss.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("color:") || trimmed.startsWith("background-color:") || trimmed.startsWith("border-color:")) {
        bump(colors, trimmed.split(":").slice(1).join(":").replace(/;$/, ""));
      }
      if (trimmed.startsWith("font-family:") || trimmed.startsWith("font-size:") || trimmed.startsWith("font-weight:")) {
        bump(typography, trimmed.split(":").slice(1).join(":").replace(/;$/, ""));
      }
      if (
        trimmed.startsWith("margin") ||
        trimmed.startsWith("padding") ||
        trimmed.startsWith("gap:") ||
        trimmed.startsWith("row-gap:") ||
        trimmed.startsWith("column-gap:")
      ) {
        bump(spacing, trimmed.split(":").slice(1).join(":").replace(/;$/, ""));
      }
      if (trimmed.startsWith("border-radius:")) {
        bump(radii, trimmed.split(":").slice(1).join(":").replace(/;$/, ""));
      }
      if (trimmed.startsWith("box-shadow:") || trimmed.startsWith("text-shadow:")) {
        bump(shadows, trimmed.split(":").slice(1).join(":").replace(/;$/, ""));
      }
    }
    for (const animation of page.animations) {
      bump(motion, `${animation.name} ${animation.durationMs}ms ${animation.easing}`);
    }
  }

  return {
    colors: topEntries(colors),
    typography: topEntries(typography),
    spacing: topEntries(spacing),
    radii: topEntries(radii),
    shadows: topEntries(shadows),
    motion: topEntries(motion),
    breakpoints: topEntries(breakpoints)
  };
}
