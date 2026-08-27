# web-crawl

`web-crawl` is an open-source Chromium extension for capturing a website into an agent-friendly design corpus.

It is built for situations where you want more than raw HTML. The extension crawls a site from the active tab, captures runtime DOM, computed CSS, assets, animations, screenshots, and a structured manifest, then exports everything as a downloadable ZIP that a coding agent can use to study and recreate the site’s design language.

## Intention

The goal of this project is to help designers, developers, and AI-assisted coding workflows understand how a live website looks and behaves in the browser.

Instead of treating scraping as text extraction only, `web-crawl` is aimed at:

- preserving visual and structural information from real rendered pages
- collecting the assets and metadata needed to reproduce a site’s design system
- making website analysis easier for coding agents and design-to-code workflows
- giving developers a transparent, hackable export pipeline they can extend

This is a best-effort runtime capture tool, not a source-code exfiltration tool. It records what the browser can observe and reports misses when assets or behaviors are blocked by browser boundaries, auth, or cross-origin restrictions.

## What It Exports

- page HTML snapshots after hydration
- computed CSS for visible elements
- discovered assets such as stylesheets, images, fonts, and scripts
- runtime animation metadata and stylesheet rules
- screenshots
- a crawl manifest and inferred design tokens
- a prompt file intended for downstream coding-agent reconstruction

## Current UX

- extension popup for starting exports
- live status dashboard in a dedicated tab
- progress, warning, and failure reporting during long crawls
- partial-export fallback when full packaging fails

## Tech Stack

- Manifest V3 Chromium extension
- TypeScript
- esbuild
- JSZip
- Vitest
- Playwright

## Development

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

Run the development build in watch mode:

```bash
npm run dev
```

Run unit tests:

```bash
npm test
```

Run the integration check:

```bash
npm run test:integration
```

To load the extension manually in Chrome:

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click `Load unpacked`
4. Select the `dist/` directory after running the build

## Open Source

This repository is intended to be open source and available for inspection, modification, and contribution. Issues and pull requests are welcome.

The project is released under the MIT License. See [LICENSE](LICENSE).

## Status

The extension is functional and already exports useful design bundles, but it is still evolving. Expect ongoing improvements around asset fidelity, packaging reliability, and crawl ergonomics.
