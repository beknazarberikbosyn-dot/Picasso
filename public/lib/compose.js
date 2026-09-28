import { finishDeck, normalizeDeck, parseModelJson } from "./deck.js";
import { gather, materialsBrief, readFlags, searchQuery } from "./research.js";
import { completeRespectingLimit, resolveCreds, serverCredsFromEnv } from "./llm.js";
import { SYSTEM_PROMPT } from "./prompt.js";

function sanitizeHistory(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 6000) }))
    .filter((item) => item.content)
    .slice(-12);
}

export async function composePresentation(body, credsOverride) {
  const history = sanitizeHistory(body?.messages);
  if (!history.some((message) => message.role === "user")) {
    const error = new Error("Напишите, какую презентацию собрать.");
    error.status = 400;
    throw error;
  }

  let current = null;
  if (body?.deck) {
    try {
      current = normalizeDeck(body.deck);
    } catch {
      const error = new Error("Текущая презентация повреждена. Начните новую.");
      error.status = 400;
      throw error;
    }
  }

  const creds =
    credsOverride ||
    (typeof process !== "undefined" && process.env ? serverCredsFromEnv() : resolveCreds());
  if (!creds.apiKey && !creds.builtin) {
    const error = new Error("Модель на сервере не настроена.");
    error.status = 500;
    throw error;
  }

  const lastUser = [...history].reverse().find((message) => message.role === "user")?.content || "";
  const flags = readFlags(lastUser);
  let materials = { facts: [], images: [], links: [] };
  if (!current || flags.images || flags.sources) {
    try {
      const query = searchQuery(current ? `${current.title}. ${lastUser}` : lastUser);
      materials = await gather(query);
    } catch {
      /* презентация соберётся без внешних материалов */
    }
  }

  let system = SYSTEM_PROMPT + materialsBrief(materials, flags);
  if (current) {
    system += `\n\nТекущая презентация. Верни полную колоду после правки:\n${JSON.stringify(current)}`;
  }

  const messages = [{ role: "system", content: system }, ...history];
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
  let reply =
    (typeof parsed.reply === "string" ? parsed.reply : "").replace(/\s+/g, " ").trim().slice(0, 600) ||
    "Презентация готова. Можно попросить правки словами.";
  if ((flags.sources || flags.images) && !materials.facts.length && !materials.images.length) {
    reply = `${reply} Открытые страницы по этой теме не нашлись, поэтому ссылки и картинки не из чего было взять.`.slice(0, 600);
  }
  return { reply, deck };
}
