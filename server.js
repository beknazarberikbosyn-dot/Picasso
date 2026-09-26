import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finishDeck, normalizeDeck, parseModelJson } from "./lib/deck.js";
import { gather, materialsBrief, readFlags, searchQuery } from "./lib/research.js";

const PORT = Number(process.env.PORT) || 3000;
const BUILTIN_BASE = "https://api.llm7.io/v1";
const BUILTIN_MODEL = "codestral-latest";
const CUSTOM_BASE = (process.env.OPENAI_BASE_URL || "").trim().replace(/\/$/, "");
const CUSTOM_MODEL = (process.env.OPENAI_MODEL || "").trim();
const CUSTOM_KEY = process.env.OPENAI_API_KEY || "";
const root = path.dirname(fileURLToPath(import.meta.url));

const SYSTEM_PROMPT = `Ты Picasso — арт-директор презентаций. Человек словами описывает, что должно быть в презентации и как она должна выглядеть. Ты это реализуешь.

Верни только JSON без markdown и без комментариев:
{
  "reply": "одно или два предложения на языке пользователя о том, что сделано",
  "deck": {
    "title": "название колоды",
    "theme": {
      "mode": "light или dark",
      "bg": "#hex фон",
      "ink": "#hex основной текст",
      "accent": "#hex акцент",
      "font": "serif или sans"
    },
    "slides": [
      {
        "layout": "hero | section | bullets | split | quote | metrics | closing | sources",
        "kicker": "короткая рубрика",
        "title": "заголовок",
        "subtitle": "подзаголовок",
        "body": "короткий абзац, если нужен",
        "bullets": ["конкретный тезис"],
        "aside": "текст боковой панели для split",
        "quote": "цитата для quote",
        "author": "автор цитаты",
        "metrics": [{"value": "128", "label": "что означает число"}],
        "image": "https:// адрес картинки из блока МАТЕРИАЛЫ, если человек просил изображения",
        "imageAlt": "что на картинке",
        "links": [{"title": "название страницы", "url": "https://...", "note": "статья или изображение"}],
        "notes": "одна фраза докладчику"
      }
    ]
  }
}

Слайд sources используй только для списка ссылок в конце: title, subtitle и links. У него нет bullets.

Правила:
- Язык слайдов совпадает с языком последней просьбы.
- Выполни и содержание, и подачу: аудитория, тон, число слайдов, цвета, плотность текста, шрифтовое настроение.
- Пиши конкретный текст: имена, места, числа, механизм или отличие. Запрещены пустые формулы «это не просто», «искусство и вкус», «в современном мире», «откройте для себя», «путешествие в мир».
- Если дан блок МАТЕРИАЛЫ, каждый содержательный слайд опирается на эти факты. Не выдумывай другие адреса.
- Если число слайдов не названо, сделай 6–8. Если названо — соблюдай его и не превышай 12.
- Первый слайд — hero, последний — closing. Между ними чередуй макеты, не делай колонку из одних списков.
- Заголовки короткие. В списке не больше пяти пунктов, каждый — одна законченная мысль.
- theme — объект с полями mode, bg, ink, accent и font. Цвета только как #hex, не описание словами.
- Пункты списка пиши только в массиве bullets. Не используй поля content, items или points.
- По умолчанию фон светлый и окрашен темой, не чёрный. Чёрный или тёмный bg только если человек прямо просит тёмную подачу.
- Цвета контрастные и связаны с темой. Просьба о светлом или тёплом фоне даёт светлый bg, просьба о тёмном — тёмный.
- Если человек просит картинки, поставь адреса из МАТЕРИАЛОВ в image у обложки и ещё одного слайда.
- Если человек просит источники или ссылки, последний слайд — sources, а в links только адреса из МАТЕРИАЛОВ.
- serif — для редакционных, спокойных и торжественных колод. sans — для продуктовых, учебных и деловых.
- Если презентация уже есть и человек просит правку, измени только нужное и верни колоду целиком.
- reply не пересказывает все слайды.`;

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
    const history = sanitizeHistory(req.body?.messages);
    if (!history.some((message) => message.role === "user")) {
      return res.status(400).json({ error: "Напишите, какую презентацию собрать." });
    }

    let current = null;
    if (req.body?.deck) {
      try {
        current = normalizeDeck(req.body.deck);
      } catch {
        return res.status(400).json({ error: "Текущая презентация повреждена. Начните новую." });
      }
    }

    const creds = serverCreds();
    if (!creds.apiKey && !creds.builtin) {
      return res.status(500).json({ error: "Модель на сервере не настроена." });
    }

    const lastUser = [...history].reverse().find((message) => message.role === "user")?.content || "";
    const flags = readFlags(lastUser);
    let materials = { facts: [], images: [], links: [] };
    if (!current || flags.images || flags.sources) {
      try {
        const query = searchQuery(current ? `${current.title}. ${lastUser}` : lastUser);
        materials = await gather(query);
        console.log(`research query="${query}" facts=${materials.facts.length} images=${materials.images.length}`);
      } catch (error) {
        console.error(error.message);
      }
    }

    let system = SYSTEM_PROMPT + materialsBrief(materials, flags);
    if (current) {
      system += `\n\nТекущая презентация. Верни полную колоду после правки:\n${JSON.stringify(current)}`;
    }

    const messages = [{ role: "system", content: system }, ...history];
    console.log(`compose model=${creds.model} slides=${current?.slides.length || 0}`);
    let text = await completeRespectingLimit(creds, messages);
    let parsed;
    try {
      parsed = parseModelJson(text);
    } catch {
      text = await completeRespectingLimit(creds, [
        ...messages,
        { role: "assistant", content: String(text).slice(0, 8000) },
        { role: "user", content: "Исправь ответ: верни только валидный JSON той же схемы, без пояснений." },
      ]);
      parsed = parseModelJson(text);
    }

    const deck = finishDeck(normalizeDeck(parsed), { materials, flags });
    const reply =
      (typeof parsed.reply === "string" ? parsed.reply : "").replace(/\s+/g, " ").trim().slice(0, 600) ||
      "Презентация готова. Можно попросить правки словами.";
    res.json({ reply, deck });
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

function sanitizeHistory(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 6000) }))
    .filter((item) => item.content)
    .slice(-12);
}

function serverCreds() {
  if (!CUSTOM_BASE && !CUSTOM_KEY) {
    return { baseUrl: BUILTIN_BASE, model: CUSTOM_MODEL || BUILTIN_MODEL, apiKey: "", builtin: true };
  }
  const baseUrl = safeBase(CUSTOM_BASE || "https://api.openai.com/v1");
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl);
  let apiKey = CUSTOM_KEY;
  if (!apiKey && local) apiKey = "ollama";
  return {
    baseUrl,
    model: (CUSTOM_MODEL || "gpt-4o-mini").slice(0, 120),
    apiKey,
    builtin: false,
  };
}

function completionsUrl(baseUrl) {
  if (/\/(?:openai|chat\/completions)$/.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function completeRespectingLimit(creds, messages) {
  try {
    return await complete(creds, messages);
  } catch (error) {
    if (error.status !== 429 || !creds.builtin) throw error;
    await delay(16000);
    return await complete(creds, messages);
  }
}

function safeBase(value) {
  const candidate = value;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    const error = new Error("Некорректный адрес API.");
    error.status = 400;
    throw error;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    const error = new Error("Адрес API должен начинаться с http или https.");
    error.status = 400;
    throw error;
  }
  return `${url.origin}${url.pathname}`.replace(/\/$/, "");
}

async function complete(creds, messages) {
  const hosted = /api\.openai\.com|openrouter\.ai/.test(creds.baseUrl);
  const attempts = creds.builtin
    ? [{ response_format: { type: "json_object" }, max_tokens: 4096 }, { max_tokens: 4096 }]
    : hosted
      ? [{ response_format: { type: "json_object" }, max_tokens: 4096 }, { max_tokens: 4096 }]
      : [{ max_tokens: 4096 }, { max_completion_tokens: 4096 }];
  let lastError;
  for (const extra of attempts) {
    try {
      return await callOnce(creds, messages, extra);
    } catch (error) {
      lastError = error;
      if (error.status !== 400) throw error;
    }
  }
  throw lastError;
}

async function callOnce(creds, messages, extra) {
  let response;
  try {
    const headers = { "Content-Type": "application/json" };
    if (creds.apiKey) headers.Authorization = `Bearer ${creds.apiKey}`;
    response = await fetch(completionsUrl(creds.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: creds.model,
        temperature: 0.7,
        messages,
        ...extra,
      }),
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    const error = new Error("Нет связи с API. Проверьте адрес и интернет.");
    error.status = 502;
    throw error;
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error(`upstream ${response.status}: ${errText.slice(0, 180)}`);
    let message = `Модель ответила с кодом ${response.status}.`;
    try {
      const parsed = JSON.parse(errText);
      const upstream = parsed.error?.message || parsed.message;
      if (upstream) message = String(upstream).slice(0, 300);
    } catch {
      /* keep the short message */
    }
    if (response.status === 401 || response.status === 403) message = "Ключ API отклонён.";
    if (response.status === 429) message = "Модель занята. Подождите немного и отправьте ещё раз.";
    if (response.status >= 500) message = "Модель сейчас недоступна. Попробуйте ещё раз через минуту.";
    const error = new Error(message);
    error.status = response.status >= 500 ? 502 : response.status;
    throw error;
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    const error = new Error("Модель вернула пустой ответ.");
    error.status = 502;
    throw error;
  }
  return text;
}

const server = app.listen(PORT, "127.0.0.1");
server.on("listening", () => {
  console.log(`Picasso → http://127.0.0.1:${PORT}`);
});
server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `Порт ${PORT} занят.` : error.message);
  process.exit(1);
});
