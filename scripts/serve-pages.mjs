import { readFile } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const port = Number.parseInt(readArg("--port") ?? process.env.PORT ?? "4173", 10);
const host = process.env.HOST ?? "127.0.0.1";
const root = resolve("out");
const basePath = "/Home-stack";
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === basePath) pathname = `${basePath}/`;
  if (!pathname.startsWith(`${basePath}/`)) {
    response.writeHead(302, { location: `${basePath}/` });
    response.end();
    return;
  }

  let relativePath = pathname.replace(/^\/Home-stack\/?/, "");
  if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";

  const filePath = join(root, relativePath);
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }

  readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(200, { "content-type": types[extname(filePath)] ?? "application/octet-stream" });
    response.end(data);
  });
}).listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}${basePath}/`);
});

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
