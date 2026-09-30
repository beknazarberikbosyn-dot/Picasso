const UA = "Picasso/1.0 (https://github.com/beknazarberikbosyn-dot/Picasso; educational presentation studio)";

export async function gather(rawQuery) {
  const query = String(rawQuery || "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (query.length < 2) return { facts: [], images: [], links: [] };

  // Поиск по Википедии ищет все слова сразу, поэтому длинный запрос часто пуст.
  // Сужаем запрос шаг за шагом, пока не найдутся факты и картинки.
  const words = query.split(/\s+/);
  const attempts = [query];
  for (const size of [3, 2, 1]) {
    const short = words.slice(0, size).join(" ");
    if (short.length >= 2 && !attempts.includes(short)) attempts.push(short);
  }

  // На Vercel у функции ограничено время, поэтому поиск не тянется дольше ~20 секунд.
  const deadline = Date.now() + 20000;
  let best = { facts: [], images: [], links: [] };
  for (const attempt of attempts) {
    if (Date.now() > deadline) break;
    const result = await gatherOnce(attempt);
    if (result.facts.length + result.images.length > best.facts.length + best.images.length) best = result;
    if (best.facts.length >= 2 && best.images.length) break;
  }
  return best;
}

async function gatherOnce(query) {
  const [ru, en, photos] = await Promise.all([
    wiki("https://ru.wikipedia.org", query),
    wiki("https://en.wikipedia.org", query),
    commons(query),
  ]);

  const found = uniqueBy([...ru, ...en], (page) => page.url);
  const matchedPages = found.filter((page) => matchesQuery(`${page.title} ${page.fact}`, query));
  const pages = (matchedPages.length ? matchedPages : found).slice(0, 5);
  const foundImages = uniqueBy(
    [...pages.flatMap((page) => (page.image ? [page.image] : [])), ...photos],
    (image) => image.key,
  );
  const matchedImages = foundImages.filter(
    (image) => matchesQuery(`${image.title} ${image.page}`, query) || pages.some((page) => page.image?.key === image.key),
  );
  // Сначала картинки, где совпало название, затем остальные результаты поиска Commons.
  const images = uniqueBy([...matchedImages, ...foundImages], (image) => image.key).slice(0, 4);
  const links = pages.map((page) => ({ title: page.title, url: page.url, note: "статья" }));
  for (const image of images) {
    if (!image.page || links.some((link) => link.url === image.page)) continue;
    links.push({ title: image.title, url: image.page, note: "изображение" });
    if (links.length >= 6) break;
  }

  return {
    facts: pages
      .map((page) => ({ text: page.fact, title: page.title, url: page.url }))
      .filter((fact) => fact.text.length >= 40)
      .slice(0, 5),
    images,
    links: links.slice(0, 6),
  };
}

const SKIP_WORD =
  /^(?:слайд\p{L}*|презентац\p{L}*|обложк\p{L}*|финал\p{L}*|фон\p{L}*|палитр\p{L}*|т[её]мн\p{L}*|светл\p{L}*|чёрн\p{L}*|черн\p{L}*|тёпл\p{L}*|тепл\p{L}*|картин\p{L}*|изображен\p{L}*|иллюстрац\p{L}*|фото\p{L}*|снимк\p{L}*|снимок|источник\p{L}*|ссылк\p{L}*|интернет\p{L}*|потусторон\p{L}*|посторон\p{L}*|сторонн\p{L}*|информац\p{L}*|связан\p{L}*|тем\p{L}?|темой|добавь|вставь|найди|возьми|реальн\p{L}*|библиограф\p{L}*|вставь\p{L}*|использу\p{L}*|макет\p{L}*|колод\p{L}*|урок\p{L}*|класс\p{L}*|конец|конце|нужн\p{L}*|хочу|сделай\p{L}*|добав\p{L}*|покаж\p{L}*|пересобер\p{L}*|для|это|как|или|при|про|что|чтобы|если|тоже|ещё|еще|уже|только|очень|между|после|перед|один\p{L}*|два|три|пять|шесть|восьм\p{L}*|девят\p{L}*|десят\p{L}*|the|and|with|from|about)$/iu;

// \b в JS не видит границы кириллических слов, поэтому границу задаём явно.
const TOPIC_PATTERNS = [
  /(?<![\p{L}\p{N}])(?:на\s+тему|тема|про|об|о)[:\s]+(.+?)(?:\s*[,.!;]|$)/iu,
  /\babout\s+(.+?)(?:\s*[,.!;]|$)/i,
  /\b(?:on|regarding)\s+(.+?)(?:\s*[,.!;]|$)/i,
];

function topicWords(text) {
  return String(text || "")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !SKIP_WORD.test(word));
}

export function searchQuery(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";

  for (const pattern of TOPIC_PATTERNS) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    const query = topicWords(match[1]).slice(0, 6).join(" ");
    if (query.length >= 2) return query.slice(0, 120);
  }

  const words = topicWords(raw);
  const query = words.slice(0, 6).join(" ");
  return (query || raw).slice(0, 120);
}

export function readFlags(text) {
  const value = String(text || "");
  return {
    images: /картин|изображен|иллюстрац|фото\p{L}*|снимк\p{L}*|снимок|снимк|снимок|визуал|picture|image|photo|pic(?![\p{L}])/iu.test(value),
    sources:
      /источник|ссылк|библиограф|литератур|сторонн|посторон|потусторон|интернет|сети|википед|открыт\p{L}*\s+страниц|материал\p{L}*\s+из|реальн\p{L}*\s+(?:факт|данн)|source|links?(?![\p{L}])|cite|reference/iu.test(
        value,
      ),
    dark: /(?:^|[^a-zа-яё])(?:т[её]мн\p{L}*|ч[её]рн\p{L}*|dark|black)(?=$|[^a-zа-яё])/iu.test(value),
  };
}

export function intentBrief(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  const lines = ["", "ПОСЛЕДНЯЯ ПРОСЬБА (выполни буквально, не игнорируй детали):", value];
  const slideMatch = value.match(/(\d{1,2})\s*слайд/i);
  if (slideMatch) lines.push(`Явно указано число слайдов: ${slideMatch[1]}.`);
  const classMatch = value.match(/(\d{1,2})\s*класс/i);
  if (classMatch) lines.push(`Аудитория: ${classMatch[1]} класс.`);
  return lines.join("\n");
}

export function materialsBrief(materials, flags) {
  const hasFacts = Boolean(materials?.facts?.length);
  const hasImages = Boolean(materials?.images?.length);
  const hasLinks = Boolean(materials?.links?.length);
  if (!hasFacts && !hasImages && !hasLinks) return "";
  const facts = materials.facts
    .map((fact, index) => `${index + 1}. ${fact.text} (${fact.title}: ${fact.url})`)
    .join("\n");
  const images = materials.images
    .map((image, index) => `${index + 1}. ${image.url} — ${image.title}`)
    .join("\n");
  const lines = [
    "",
    "МАТЕРИАЛЫ из открытых страниц. Это единственные разрешённые факты, адреса картинок и ссылки. Не выдумывай другие URL и не подменяй эти факты общими фразами.",
  ];
  if (facts) lines.push(`Факты:\n${facts}`);
  if (images && flags.images) lines.push(`Картинки, которые нужно поставить на слайды в поле image:\n${images}`);
  if (materials.links?.length && flags.sources) {
    lines.push(
      "Последний слайд сделай layout sources и перечисли эти ссылки в links: " +
        materials.links.map((link) => `${link.title} — ${link.url}`).join("; "),
    );
  }
  return lines.join("\n");
}

async function wiki(origin, query) {
  try {
    return await wikiPages(origin, query);
  } catch {
    return [];
  }
}

async function wikiPages(origin, query) {
  const url = new URL("/w/api.php", origin);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "5",
    gsrnamespace: "0",
    prop: "extracts|info|pageimages",
    inprop: "url",
    exintro: "1",
    explaintext: "1",
    exchars: "1200",
    pithumbsize: "1280",
    redirects: "1",
  }).toString();
  const data = await getJson(url);
  const pages = Object.values(data?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages
    .map((page) => {
      const extract = String(page.extract || "").replace(/\s+/g, " ").trim();
      if (!page.fullurl || extract.length < 40 || /может означать:|may refer to|\(значения\)|disambiguation/i.test(`${page.title} ${extract}`)) return null;
      const thumb = page.thumbnail?.source || "";
      const image = thumb.startsWith("https://")
        ? { url: thumb, title: page.title, page: page.fullurl, key: urlKey(thumb) }
        : null;
      return {
        title: String(page.title || "Статья").slice(0, 120),
        url: page.fullurl,
        fact: sentence(extract),
        image,
      };
    })
    .filter(Boolean);
}

async function commons(query) {
  try {
    return await commonsPhotos(query);
  } catch {
    return [];
  }
}

async function commonsPhotos(query) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: "6",
    gsrnamespace: "6",
    prop: "imageinfo",
    iiprop: "url|mime|size|descriptionurl",
    iiurlwidth: "1400",
  }).toString();
  const data = await getJson(url);
  const pages = Object.values(data?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages
    .map((page) => {
      const info = page.imageinfo?.[0];
      if (!info) return null;
      const mime = info.mime || "";
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) return null;
      if ((info.thumbwidth || info.width || 0) < 640) return null;
      const src = info.thumburl || info.url;
      if (!src?.startsWith("https://")) return null;
      const title = String(page.title || "Изображение").replace(/^File:/, "").replace(/_/g, " ").slice(0, 120);
      return {
        url: src,
        title,
        page: info.descriptionurl || "",
        key: urlKey(src),
      };
    })
    .filter(Boolean);
}

const IN_BROWSER = typeof window !== "undefined" && typeof document !== "undefined";

async function getJson(url) {
  // Из браузера (GitHub Pages) Википедия отвечает только с origin=* и без своих заголовков.
  url.searchParams.set("origin", "*");
  const response = await fetch(url, {
    headers: IN_BROWSER ? {} : { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Материалы ответили с кодом ${response.status}.`);
  return response.json();
}

function matchesQuery(text, query) {
  const needles = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .map((word) => word.slice(0, 8));
  if (!needles.length) return true;
  const hay = String(text || "").toLowerCase();
  return needles.some((needle) => hay.includes(needle));
}

function sentence(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks = clean.split(/(?<=[.!?])\s+/);
  let built = "";
  for (const chunk of chunks) {
    if (built.length >= 360) break;
    built = built ? `${built} ${chunk}` : chunk;
  }
  if (built.length < 80) built = clean;
  return built.slice(0, 600).trim();
}

function urlKey(value) {
  try {
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname.split("/").pop() || "").replace(/^\d+px-/i, "");
    return name.toLowerCase();
  } catch {
    return "";
  }
}

function uniqueBy(list, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
