import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const outdir = path.join(root, "dist");
const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["chrome114"],
  sourcemap: true,
  logLevel: "info",
  tsconfig: path.join(root, "tsconfig.json"),
  outdir
};

const entries = [
  {
    entryPoints: {
      background: path.join(root, "src/background.ts")
    }
  },
  {
    entryPoints: {
      content: path.join(root, "src/content/content-script.ts")
    }
  },
  {
    entryPoints: {
      popup: path.join(root, "src/popup/popup.ts")
    }
  }
];

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await cp(path.join(root, "public"), outdir, { recursive: true });

if (watch) {
  const contexts = await Promise.all(entries.map((config) => context({ ...shared, ...config })));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("Watching extension sources...");
} else {
  for (const config of entries) {
    await build({ ...shared, ...config });
  }
}
