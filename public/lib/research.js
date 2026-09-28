const UA = "Picasso/1.0 (https://github.com/beknazarberikbosyn-dot/Picasso; educational presentation studio)";

export async function gather(rawQuery) {
  const query = String(rawQuery || "").replace(/\s+/g, " ").trim().slice(0, 140);
  if (query.length < 2) return { facts: [], images: [], links: [] };

  let result = await gatherOnce(query);
  if (!result.facts.length && !result.images.length) {
    const short = query.split(/\s+/).slice(0, 2).join(" ");
    if (short.length >= 2 && short !== query) result = await gatherOnce(short);
  }
  return result;
}

async function gatherOnce(query) {
  const [ru, en, photos] = await Promise.all([
    wiki("https://ru.wikipedia.org", query),
    wiki("https://en.wikipedia.org", query),
    commons(query),
  ]);

  const found = uniqueBy([...ru, ...en], (page) => page.url);
  const matchedPages = found.filter((page) => matchesQuery(`${page.title} ${page.fact}`, query));
  const pages = (matchedPages.length ? matchedPages : found).slice(0, 4);
  const foundImages = uniqueBy(
    [...pages.flatMap((page) => (page.image ? [page.image] : [])), ...photos],
    (image) => image.key,
  );
  const matchedImages = foundImages.filter(
    (image) => matchesQuery(`${image.title} ${image.page}`, query) || pages.some((page) => page.image?.key === image.key),
  );
  const images = (matchedImages.length ? matchedImages : foundImages).slice(0, 4);
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
      .slice(0, 4),
    images,
    links: links.slice(0, 6),
  };
}

const SKIP_WORD =
  /^(?:слайд\p{L}*|презентац\p{L}*|обложк\p{L}*|финал\p{L}*|фон\p{L}*|палитр\p{L}*|т[её]мн\p{L}*|светл\p{L}*|чёрн\p{L}*|черн\p{L}*|тёпл\p{L}*|тепл\p{L}*|картин\p{L}*|изображен\p{L}*|иллюстрац\p{L}*|фото|источник\p{L}*|ссылк\p{L}*|интернет\p{L}*|потусторон\p{L}*|посторон\p{L}*|вставь\p{L}*|использу\p{L}*|макет\p{L}*|колод\p{L}*|урок\p{L}*|класс\p{L}*|конец|конце|нужн\p{L}*|хочу|сделай\p{L}*|добав\p{L}*|покаж\p{L}*|пересобер\p{L}*|конкретн\p{L}*|факт\p{L}*|угроз\p{L}*|пут\p{L}*|спасен\p{L}*|вымиран\p{L}*|причин\p{L}*|возможн\p{L}*|решен\p{L}*|исследован\p{L}*|для|это|как|или|при|про|что|чтобы|если|тоже|ещё|еще|уже|только|очень|между|после|перед|один\p{L}*|два|три|пять|шесть|the|and|with|from|about)$/iu;

export function searchQuery(text) {
  const words = String(text || "")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !SKIP_WORD.test(word));
  const query = words.slice(0, 6).join(" ");
  return (query || String(text || "")).slice(0, 120);
}

export function readFlags(text) {
  const value = String(text || "");
  return {
    images: /картин|изображен|иллюстрац|фото|picture|image|photo/i.test(value),
    sources: /источник|ссылк|посторон|потусторон|source|\blinks?\b/i.test(value),
    dark: /(?:^|[^a-zа-яё])(?:т[её]мн\p{L}*|ч[её]рн\p{L}*|dark|black)(?=$|[^a-zа-яё])/iu.test(value),
  };
}

export function materialsBrief(materials, flags) {
  if (!materials?.facts?.length && !materials?.images?.length) return "";
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
    gsrlimit: "4",
    gsrnamespace: "0",
    prop: "extracts|info|pageimages",
    inprop: "url",
    exintro: "1",
    explaintext: "1",
    exchars: "420",
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

async function getJson(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Материалы ответили с кодом ${response.status}.`);
  return response.json();
}

function matchesQuery(text, query) {
  const needles = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 5)
    .map((word) => word.slice(0, 6));
  if (!needles.length) return true;
  const hay = String(text || "").toLowerCase();
  return needles.some((needle) => hay.includes(needle));
}

function sentence(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks = clean.split(/(?<=[.!?])\s+/);
  let built = "";
  for (const chunk of chunks) {
    if (built.length >= 90) break;
    built = built ? `${built} ${chunk}` : chunk;
  }
  if (built.length < 80) built = clean;
  return built.slice(0, 280).trim();
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
