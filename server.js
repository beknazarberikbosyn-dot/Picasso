import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composePresentation } from "./docs/lib/compose.js";
import { serverCredsFromEnv } from "./docs/lib/llm.js";

const PORT = Number(process.env.PORT) || 3000;
const root = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ready: true });
});

app.post("/api/compose", async (req, res) => {
  try {
    const creds = serverCredsFromEnv();
    if (!creds.apiKey && !creds.builtin) {
      return res.status(500).json({ error: "Модель на сервере не настроена." });
    }
    const result = await composePresentation(req.body, creds);
    res.json(result);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    console.error(error.message);
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: error.message || "Не получилось собрать презентацию.",
    });
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

const server = app.listen(PORT, "127.0.0.1");
server.on("listening", () => {
  console.log(`Picasso → http://127.0.0.1:${PORT}`);
});
server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `Порт ${PORT} занят.` : error.message);
  process.exit(1);
});
