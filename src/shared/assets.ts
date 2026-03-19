import { safeFileName } from "./url";

export function inferAssetType(url: string, mimeType?: string): string {
  const lower = url.toLowerCase();
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif|ico)(\?|$)/.test(lower)) return "image";
  if (mime.startsWith("font/") || /\.(woff2?|ttf|otf|eot)(\?|$)/.test(lower)) return "font";
  if (mime.includes("css") || /\.css(\?|$)/.test(lower)) return "stylesheet";
  if (mime.includes("javascript") || /\.(m?js)(\?|$)/.test(lower)) return "script";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov)(\?|$)/.test(lower)) return "video";
  return "asset";
}

export function assetPathForUrl(url: string, mimeType?: string): string {
  const assetType = inferAssetType(url, mimeType);
  const parsed = new URL(url);
  const rawName = parsed.pathname.split("/").pop() || parsed.hostname;
  const fileName = safeFileName(decodeURIComponent(rawName));
  return `assets/${assetType}/${fileName}`;
}
