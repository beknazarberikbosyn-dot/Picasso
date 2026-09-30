import { deckLooksEmpty, emptySlides, finishDeck, normalizeDeck, parseModelJson } from "./deck.js";
import { gather, intentBrief, materialsBrief, readFlags, searchQuery } from "./research.js";
import { completeRespectingLimit, resolveCreds, serverCredsFromEnv } from "./llm.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { isTemplate, templateById } from "./templates.js";

function sanitizeHistory(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 6000) }))
    .filter((item) => item.content)
    .slice(-12);
}

async function askJson(creds, messages) {
  let text = await completeRespectingLimit(creds, messages);
  try {
    return { text, parsed: parseModelJson(text) };
  } catch {
    text = await completeRespectingLimit(creds, [
      ...messages,
      { role: "assistant", content: String(text).slice(0, 8000) },
      { role: "user", content: "Исправь ответ: верни только валидный JSON той же схемы, без пояснений." },
    ]);
    return { text, parsed: parseModelJson(text) };
  }
}

export async function composePresentation(body, credsOverride) {
  const startedAt = Date.now();
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

  const userTexts = history.filter((message) => message.role === "user").map((message) => message.content);
  const lastUser = userTexts.at(-1) || "";
  const allUser = userTexts.join("\n");
  const flags = readFlags(allUser);
  flags.dark = readFlags(lastUser).dark;

  let materials = { facts: [], images: [], links: [] };
  // \b в JS не работает с кириллицей, поэтому границу слова задаём явно.
  const topicChange = /(?<![\p{L}\p{N}])(?:про|об?|тема|на\s+тему|переделай|друг\p{L}*\s+тем|замени\s+тем)(?![\p{L}\p{N}])/iu.test(lastUser);
  const shouldResearch = !current || flags.images || flags.sources || topicChange;
  if (shouldResearch) {
    try {
      // Тема берётся из первой просьбы (или из новой, если тему меняют), а не из просьбы «добавь фото».
      const firstUser = userTexts[0] || "";
      let query = topicChange && current ? searchQuery(lastUser) : "";
      if (!query) query = searchQuery(current ? firstUser : lastUser);
      if (!query && current) query = searchQuery(current.title);
      materials = await gather(query);
    } catch {
      /* презентация соберётся без внешних материалов */
    }
  }

  if (materials.links.length && (flags.sources || !current)) flags.sources = true;

  const template = isTemplate(body?.template) ? body.template : current?.template;
  const topic = current?.topic || userTexts[0] || lastUser;
  const colorRequest = /цвет|палитр|фон|оттен|т[её]мн|светл|colou?r|palette|background/iu.test(lastUser);
  const keepColors = Boolean(current && (colorRequest || current.customColors));

  let system = SYSTEM_PROMPT + intentBrief(lastUser) + materialsBrief(materials, flags);
  if (template) {
    const chosen = templateById(template);
    system +=
      `\n\nШАБЛОН «${chosen.name}» выбран человеком. ${chosen.hint}` +
      (keepColors ? "" : " Цвета и шрифты задаёт шаблон — в theme верни что угодно, сосредоточься на содержании.");
  }
  if (current) {
    system += `\n\nТекущая презентация. Верни полную колоду после правки:\n${JSON.stringify(current)}`;
  }

  const messages = [{ role: "system", content: system }, ...history];
  let { text, parsed } = await askJson(creds, messages);
  let deck = normalizeDeck(parsed);

  // Слабые модели иногда возвращают «скелет» — слайды с одними заголовками.
  // Один раз просим дописать содержимое, если на это хватает времени функции.
  // Если факты из Википедии есть, пустые слайды дополнятся ими без второго запроса к модели —
  // так бесплатный лимит запросов тратится вдвое медленнее.
  if (deckLooksEmpty(deck) && !materials.facts.length && Date.now() - startedAt < 30000) {
    const empty = emptySlides(deck).map((slide) => `«${slide.title}»`).join(", ");
    try {
      const again = await askJson(creds, [
        ...messages,
        { role: "assistant", content: String(text).slice(0, 8000) },
        {
          role: "user",
          content:
            `Слайды ${empty || "в середине"} пустые — на них только заголовок. ` +
            "Заполни каждый содержательный слайд: 3–5 конкретных пунктов в bullets (факты, имена, даты, числа) или абзац в body. " +
            (materials.facts.length ? "Опирайся на факты из блока МАТЕРИАЛЫ. " : "") +
            "Верни полную колоду тем же JSON.",
        },
      ]);
      const fuller = normalizeDeck(again.parsed);
      if (emptySlides(fuller).length < emptySlides(deck).length) {
        parsed = again.parsed;
        deck = fuller;
      }
    } catch {
      /* оставляем первый вариант, дальше его дополнят факты */
    }
  }

  deck = finishDeck(deck, { materials, flags, template, topic, keepColors });
  if (keepColors && template) deck.customColors = true;
  let reply =
    (typeof parsed.reply === "string" ? parsed.reply : "").replace(/\s+/g, " ").trim().slice(0, 600) ||
    "Презентация готова. Можно попросить правки словами.";
  if ((flags.sources || flags.images) && !materials.facts.length && !materials.images.length) {
    reply = `${reply} Открытые страницы по этой теме не нашлись, поэтому ссылки и картинки не из чего было взять.`.slice(0, 600);
  }
  return { reply, deck };
}
