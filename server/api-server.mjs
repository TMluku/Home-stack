import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalRestApi } from "../api/local-rest-api.js";
import { createDefaultState, detectedInventoryCandidates, normalizeState } from "../data/demo-state.js";
import { baseOffers } from "../data/offers.js";

const DEFAULT_PORT = 4173;
const API_PREFIX = "/api";
const ROOT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)));

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function createDetectedItem(index) {
  const [name, category, stock, dailyUsage, note] = detectedInventoryCandidates[index % detectedInventoryCandidates.length];
  return { id: `server-detected-${Date.now()}-${index}`, name, category, stock, dailyUsage, autoReplenish: false, note };
}

function sendJson(response, payload, status = payload.status || 200) {
  response.writeHead(status, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function sendNotFound(response) {
  sendJson(response, { ok: false, status: 404, data: null, error: { message: "Not found" } }, 404);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (!rawBody) return {};
  return JSON.parse(rawBody);
}

function resolveStaticPath(urlPath, rootDir) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  const normalizedPath = normalize(decodedPath === "/" ? "/index.html" : decodedPath).replace(/^[/\\]+/, "");
  const filePath = resolve(join(rootDir, normalizedPath));
  if (!filePath.startsWith(rootDir)) return null;
  return filePath;
}

async function serveStatic(request, response, rootDir) {
  const filePath = resolveStaticPath(request.url || "/", rootDir);
  if (!filePath) {
    sendNotFound(response);
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "content-type": CONTENT_TYPES[extname(filePath)] || "application/octet-stream" });
    response.end(content);
  } catch {
    sendNotFound(response);
  }
}

export function createHomeStackServer({ rootDir = ROOT_DIR, initialState = createDefaultState() } = {}) {
  let state = normalizeState(initialState);
  const api = createLocalRestApi({
    getState: () => state,
    setState: (nextState) => {
      state = normalizeState(nextState);
    },
    saveState: () => {},
    createDefaultState,
    createDetectedItem,
    offers: baseOffers,
  });

  return createHttpServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://localhost");

    if (request.method === "OPTIONS") {
      sendJson(response, { ok: true, status: 204, data: null, error: null }, 204);
      return;
    }

    if (url.pathname.startsWith(`${API_PREFIX}/`) || url.pathname === API_PREFIX) {
      try {
        const body = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method || "") ? await readJsonBody(request) : {};
        const apiPath = url.pathname.slice(API_PREFIX.length) || "/";
        const result = await api.request(request.method || "GET", apiPath, body);
        sendJson(response, result, result.status);
      } catch (error) {
        sendJson(
          response,
          { ok: false, status: 400, data: null, error: { message: "Invalid request body", details: { cause: error.message } } },
          400,
        );
      }
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendNotFound(response);
      return;
    }

    await serveStatic(request, response, rootDir);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  createHomeStackServer().listen(port, () => {
    console.log(`Home Stack API server listening on http://localhost:${port}`);
  });
}
