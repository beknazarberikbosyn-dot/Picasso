import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "docs"),
  path.join(here, "..", "public"),
  path.join(here, "..", "docs"),
];

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function requestedFile(request) {
  const fromQuery = request.query?.path;
  const queryPath = Array.isArray(fromQuery) ? fromQuery.join("/") : fromQuery;
  const url = new URL(request.url || "/", "http://localhost");
  let name = String(queryPath || url.searchParams.get("path") || "index.html");
  name = name.replace(/^\/+/, "");
  if (!name || name.endsWith("/")) name = `${name}index.html`;
  if (name.includes("..") || path.isAbsolute(name)) return "";
  return name;
}

function locate(name) {
  for (const root of roots) {
    const file = path.join(root, name);
    if (!file.startsWith(root)) continue;
    try {
      if (statSync(file).isFile()) return file;
    } catch {
      /* try the next root */
    }
  }
  return "";
}

export default function handler(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return response.status(405).json({ error: "Нужен GET." });
  }
  const name = requestedFile(request);
  const file = name ? locate(name) : "";
  if (!file) return response.status(404).json({ error: "Нет файла", path: name || "/" });
  const body = readFileSync(file);
  response.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
  // no-cache: браузер каждый раз сверяется с сервером, и обновления видны сразу.
  response.setHeader("Cache-Control", "no-cache");
  if (request.method === "HEAD") return response.status(200).end();
  return response.status(200).send(body);
}
