import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiErrorResponse, getHealth, postCompose } from "./docs/lib/api-routes.js";
import { CORS_HEADERS } from "./docs/lib/cors.js";

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const root = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use((req, res, next) => {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json(getHealth());
});

app.post("/api/compose", async (req, res) => {
  try {
    const result = await postCompose(req.body);
    res.json(result);
  } catch (error) {
    console.error(error.message);
    const { status, body } = apiErrorResponse(error);
    res.status(status).json(body);
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Нет такого метода." });
});

app.use(express.static(path.join(root, "docs")));

app.use((error, _req, res, next) => {
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Некорректный запрос." });
  }
  return next(error);
});

const server = app.listen(PORT, HOST);
server.on("listening", () => {
  const host = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  console.log(`Picasso → http://${host}:${PORT}`);
});
server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `Порт ${PORT} занят.` : error.message);
  process.exit(1);
});
