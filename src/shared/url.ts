import type { CrawlScope } from "./types";

export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.searchParams.sort();
  return url.toString();
}

export function shouldVisitUrl(rawUrl: string, startUrl: string, scope: CrawlScope): boolean {
  const target = new URL(rawUrl);
  const start = new URL(startUrl);
  if (!["http:", "https:"].includes(target.protocol)) {
    return false;
  }
  if (target.origin !== start.origin) {
    return false;
  }
  if (scope === "path") {
    const prefix = start.pathname.endsWith("/") ? start.pathname : `${start.pathname}/`;
    const targetPath = target.pathname.endsWith("/") ? target.pathname : `${target.pathname}/`;
    return target.pathname === start.pathname || targetPath.startsWith(prefix);
  }
  return true;
}

export function safeFileName(input: string): string {
  return input
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "file";
}

export function pageIdFromUrl(url: string, index: number): string {
  const normalized = new URL(url);
  const path = `${normalized.hostname}${normalized.pathname}${normalized.search}`;
  return `${String(index).padStart(3, "0")}-${safeFileName(path)}`;
}
