import type { AnimationRecord, AssetRecord, ExportSettings, LinkRecord, PageSnapshot } from "../shared/types";
import { inferAssetType } from "../shared/assets";

const SELECTOR_ATTR = "data-design-export-id";
const STYLE_PROPERTIES = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "width",
  "height",
  "max-width",
  "max-height",
  "min-width",
  "min-height",
  "margin",
  "padding",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "flex",
  "flex-direction",
  "align-items",
  "justify-content",
  "color",
  "background",
  "background-color",
  "background-image",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-transform",
  "text-decoration",
  "transform",
  "transform-origin",
  "transition",
  "animation"
];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SCRAPE_PAGE") return;
  void scrapePage(message.payload as ExportSettings)
    .then((snapshot) => sendResponse({ ok: true, snapshot }))
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

async function scrapePage(settings: ExportSettings): Promise<PageSnapshot> {
  await waitForSettledLoad();
  if (settings.autoScroll) {
    await autoScrollPage();
  }
  const notes: string[] = [];
  annotateVisibleElements();
  const root = document.documentElement.cloneNode(true) as HTMLElement;
  const computedCss = collectComputedCss();
  const assets = collectAssets(settings.maxAssetsPerPage);
  const links = collectLinks();
  const animations = collectAnimations();
  const stylesheetRules = collectStylesheetRules(notes);
  const fonts = collectFonts(notes);
  const inlineScripts = [...document.scripts]
    .filter((script) => !script.src)
    .map((script) => script.textContent?.trim() ?? "")
    .filter(Boolean);
  const domHtml = root.outerHTML;
  cleanupAnnotations();

  return {
    url: location.href,
    title: document.title,
    domHtml,
    computedCss,
    links,
    assets,
    inlineScripts,
    stylesheetRules,
    fonts,
    animations,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      fullHeight: Math.max(
        document.body?.scrollHeight ?? 0,
        document.documentElement.scrollHeight,
        window.innerHeight
      )
    },
    extractionTime: new Date().toISOString(),
    notes
  };
}

async function waitForSettledLoad(): Promise<void> {
  if (document.readyState === "complete") {
    await delay(700);
    return;
  }
  await new Promise<void>((resolve) => {
    window.addEventListener("load", () => resolve(), { once: true });
  });
  await delay(700);
}

async function autoScrollPage(): Promise<void> {
  const step = Math.max(window.innerHeight * 0.75, 400);
  const limit = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
  for (let offset = 0; offset < limit; offset += step) {
    window.scrollTo({ top: offset, behavior: "auto" });
    await delay(120);
  }
  window.scrollTo({ top: 0, behavior: "auto" });
  await delay(200);
}

function annotateVisibleElements(): void {
  const visible = [...document.querySelectorAll<HTMLElement>("body *")].filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  });
  visible.forEach((element, index) => {
    element.setAttribute(SELECTOR_ATTR, String(index));
  });
}

function cleanupAnnotations(): void {
  document.querySelectorAll(`[${SELECTOR_ATTR}]`).forEach((element) => {
    element.removeAttribute(SELECTOR_ATTR);
  });
}

function collectComputedCss(): string {
  const blocks: string[] = [];
  document.querySelectorAll<HTMLElement>(`[${SELECTOR_ATTR}]`).forEach((element) => {
    const style = window.getComputedStyle(element);
    const selector = `[${SELECTOR_ATTR}="${element.getAttribute(SELECTOR_ATTR)}"]`;
    const lines = STYLE_PROPERTIES.map((property) => `  ${property}: ${style.getPropertyValue(property)};`).filter(
      (line) => !line.endsWith(": ;")
    );
    blocks.push(`${selector} {\n${lines.join("\n")}\n}`);
  });
  return blocks.join("\n\n");
}

function collectLinks(): LinkRecord[] {
  return [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
    .map((anchor) => ({
      url: new URL(anchor.href, location.href).toString(),
      text: anchor.textContent?.trim() ?? ""
    }))
    .filter((record, index, list) => list.findIndex((item) => item.url === record.url) === index);
}

function collectAssets(limit: number): AssetRecord[] {
  const records: AssetRecord[] = [];
  const addAsset = (url: string, source: string, mimeType?: string) => {
    try {
      const absolute = new URL(url, location.href).toString();
      if (records.some((record) => record.url === absolute)) return;
      records.push({
        url: absolute,
        source,
        mimeType,
        type: inferAssetType(absolute, mimeType),
        status: "skipped"
      });
    } catch {
      // Ignore malformed asset URLs.
    }
  };

  for (const img of document.images) addAsset(img.currentSrc || img.src, "img");
  for (const source of document.querySelectorAll<HTMLSourceElement>("source[src], source[srcset]")) {
    if (source.src) addAsset(source.src, "source");
    if (source.srcset) source.srcset.split(",").forEach((entry) => addAsset(entry.trim().split(" ")[0], "srcset"));
  }
  for (const script of document.scripts) if (script.src) addAsset(script.src, "script");
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[href], link[rel="preload"][as]')) {
    addAsset(link.href, link.rel || "link");
  }

  document.querySelectorAll<HTMLElement>("*").forEach((element) => {
    const style = getComputedStyle(element);
    const background = style.backgroundImage;
    const matches = [...background.matchAll(/url\((['"]?)(.*?)\1\)/g)];
    for (const match of matches) addAsset(match[2], "background");
  });

  return records.slice(0, limit);
}

function collectAnimations(): AnimationRecord[] {
  const records: AnimationRecord[] = [];
  const animations = document.getAnimations({ subtree: true });
  for (const animation of animations) {
    const effect = animation.effect;
    const target = effect && "target" in effect ? (effect.target as Element | null) : null;
    const computedTiming = effect?.getComputedTiming?.();
    if (!target || !computedTiming) continue;
    records.push({
      target: target instanceof Element ? target.tagName.toLowerCase() : "unknown",
      name: (animation as Animation & { animationName?: string }).animationName ?? "runtime-animation",
      durationMs: Number(computedTiming.duration) || 0,
      delayMs: Number(computedTiming.delay) || 0,
      easing: computedTiming.easing || "linear",
      iterations: String(computedTiming.iterations ?? 1),
      direction: computedTiming.direction || "normal",
      fill: computedTiming.fill || "none"
    });
  }
  return records;
}

function collectStylesheetRules(notes: string[]): string[] {
  const rules: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    try {
      for (const rule of [...sheet.cssRules]) {
        rules.push(rule.cssText);
      }
    } catch {
      notes.push(`Could not read stylesheet rules from ${sheet.href ?? "inline stylesheet"}.`);
    }
  }
  return rules;
}

function collectFonts(notes: string[]): string[] {
  const fonts = new Set<string>();
  document.querySelectorAll<HTMLElement>("body, body *").forEach((element) => {
    const family = getComputedStyle(element).fontFamily;
    if (family) fonts.add(family);
  });
  try {
    for (const face of (document as Document & { fonts?: FontFaceSet }).fonts ?? []) {
      fonts.add(`${face.family}:${face.status}`);
    }
  } catch {
    notes.push("FontFaceSet iteration was unavailable.");
  }
  return [...fonts];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
