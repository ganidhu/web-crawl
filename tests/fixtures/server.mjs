import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "tests/fixtures/site");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".woff2", "font/woff2"]
]);

http
  .createServer(async (req, res) => {
    try {
      const requestPath = req.url === "/" ? "/index.html" : req.url ?? "/index.html";
      const filePath = path.join(root, requestPath);
      const body = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { "content-type": contentTypes.get(ext) ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(4173, "127.0.0.1", () => {
    console.log("Fixture site on http://127.0.0.1:4173");
  });
