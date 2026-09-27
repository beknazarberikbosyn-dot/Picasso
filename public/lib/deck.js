const LAYOUTS = new Set(["hero", "section", "bullets", "split", "quote", "metrics", "closing", "sources"]);

function asText(value, max) {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function asColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  let hex = value.trim();
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = `#${hex.split("").map((char) => char + char).join("")}`;
  } else if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    hex = `#${hex}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : fallback;
}

function luma(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const left = luma(a);
  const right = luma(b);
  const [hi, lo] = left > right ? [left, right] : [right, left];
  return (hi + 0.05) / (lo + 0.05);
}

function mix(a, b, amount) {
  const left = Number.parseInt(a.slice(1), 16);
  const right = Number.parseInt(b.slice(1), 16);
  const channel = (shift) =>
    Math.round(((left >> shift) & 255) * (1 - amount) + ((right >> shift) & 255) * amount);
  return `#${[channel(16), channel(8), channel(0)].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeTheme(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const dark = source.mode === "dark";
  const fallback = dark
    ? { bg: "#16181d", ink: "#f6f1e8", accent: "#ff5a36" }
    : { bg: "#f6f1e8", ink: "#1c1917", accent: "#d83c22" };
  const bg = asColor(source.bg || source.background, fallback.bg);
  let ink = asColor(source.ink || source.foreground || source.color, fallback.ink);
  let accent = asColor(source.accent, fallback.accent);
  if (contrast(bg, ink) < 4.5) ink = luma(bg) > 0.45 ? "#1c1917" : "#f6f1e8";
  if (contrast(bg, accent) < 2.4) accent = luma(bg) > 0.45 ? "#c4321a" : "#ffb088";
  const light = luma(bg) > 0.45;
  return {
    mode: light ? "light" : "dark",
    bg,
    ink,
    accent,
    muted: mix(ink, bg, 0.42),
    accentSoft: mix(bg, accent, light ? 0.14 : 0.28),
    font: source.font === "sans" ? "sans" : "serif",
  };
}

function normalizeSlide(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const bullets = (Array.isArray(source.bullets) ? source.bullets : [])
    .map((item) => asText(typeof item === "string" ? item : item?.text, 240))
    .filter(Boolean)
    .slice(0, 5);
  const metrics = (Array.isArray(source.metrics) ? source.metrics : [])
    .map((item) => ({
      value: asText(item?.value ?? item?.stat, 16),
      label: asText(item?.label, 80),
    }))
    .filter((item) => item.value)
    .slice(0, 4);
  const links = normalizeLinks(source.links || source.sources);
  let layout = String(source.layout || "").toLowerCase();
  if (!LAYOUTS.has(layout)) {
    if (links.length) layout = "sources";
    else if (asText(source.quote, 20)) layout = "quote";
    else if (metrics.length) layout = "metrics";
    else if (bullets.length) layout = "bullets";
    else layout = index === 0 ? "hero" : "bullets";
  }
  return {
    layout,
    kicker: asText(source.kicker, 48),
    title: asText(source.title, 140),
    subtitle: asText(source.subtitle, 280),
    body: asText(source.body, 560),
    bullets,
    aside: asText(source.aside, 360),
    quote: asText(source.quote, 320),
    author: asText(source.author, 80),
    metrics,
    notes: asText(source.notes, 500),
    image: httpsUrl(source.image || source.imageUrl),
    imageAlt: asText(source.imageAlt || source.image_alt, 140),
    links,
  };
}

function normalizeLinks(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const links = [];
  for (const item of list) {
    const url = httpsUrl(typeof item === "string" ? item : item?.url || item?.href);
    const title = asText(typeof item === "string" ? item : item?.title || item?.name, 140);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ title: title || hostOf(url), url, note: asText(item?.note, 40) });
    if (links.length >= 6) break;
  }
  return links;
}

function httpsUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.href.slice(0, 700);
  } catch {
    return "";
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Источник";
  }
}

function hasContent(slide) {
  return Boolean(
    slide.title ||
      slide.quote ||
      slide.body ||
      slide.bullets.length ||
      slide.metrics.length ||
      slide.subtitle ||
      slide.links.length ||
      slide.image,
  );
}

export function normalizeDeck(input) {
  if (!input || typeof input !== "object") throw new Error("В ответе не было презентации.");
  const root = input.deck && typeof input.deck === "object" ? input.deck : input;
  const slides = (Array.isArray(root.slides) ? root.slides : [])
    .map(normalizeSlide)
    .filter(hasContent)
    .slice(0, 12);
  if (!slides.length) throw new Error("В ответе не было слайдов.");
  const title = asText(root.title, 80) || slides[0].title || "Презентация";
  if (!slides[0].title) slides[0].title = title;
  return { title, theme: normalizeTheme(root.theme), slides };
}

export function finishDeck(deck, { materials, flags }) {
  const facts = materials?.facts || [];
  const images = materials?.images || [];
  const links = materials?.links || [];
  const allowedImages = new Set(images.map((image) => urlPath(image.url)));
  const allowedLinks = new Set(links.map((link) => link.url));

  for (const slide of deck.slides) {
    if (slide.image && !allowedImages.has(urlPath(slide.image))) {
      slide.image = "";
      slide.imageAlt = "";
    }
    slide.links = slide.links.filter((link) => allowedLinks.has(link.url));
  }

  if (!flags.dark && luma(deck.theme.bg) < 0.18) {
    const accent = contrast("#f7f1e8", deck.theme.accent) >= 2.4 ? deck.theme.accent : "#c4502a";
    deck.theme = normalizeTheme({
      mode: "light",
      bg: "#f7f1e8",
      ink: "#1c1917",
      accent,
      font: deck.theme.font,
    });
  }

  if (flags.images && images.length) {
    for (const slide of deck.slides) {
      slide.image = "";
      slide.imageAlt = "";
    }
    const open = deck.slides.filter((slide) => slide.layout !== "sources");
    const hero = open.find((slide) => slide.layout === "hero") || open[0];
    const detail =
      open.find((slide) => slide !== hero && (slide.layout === "bullets" || slide.layout === "split")) ||
      open.find((slide) => slide !== hero && slide.layout !== "closing");
    const used = new Set();
    for (const slide of [hero, detail]) {
      if (!slide) continue;
      const image = images.find((item) => !used.has(urlPath(item.url)));
      if (!image) break;
      slide.image = image.url;
      slide.imageAlt = image.title;
      used.add(urlPath(image.url));
    }
  } else if (!flags.images) {
    for (const slide of deck.slides) {
      slide.image = "";
      slide.imageAlt = "";
    }
  }

  deck.slides = deck.slides.filter((slide) => slide.layout !== "sources" || flags.sources);
  if (flags.sources && links.length) {
    let sources = deck.slides.find((slide) => slide.layout === "sources");
    if (!sources) {
      sources = blankSlide("sources");
      sources.kicker = "Источники";
      sources.title = "Откуда это взято";
      sources.subtitle = "Страницы и изображения, по которым собрана колода.";
      sources.notes = "Откройте ссылку, если нужно показать источник.";
      if (deck.slides.length >= 12) deck.slides.splice(deck.slides.length - 1, 1, sources);
      else deck.slides.push(sources);
    }
    const seen = new Set(sources.links.map((link) => link.url));
    for (const link of links) {
      if (sources.links.length >= 6 || seen.has(link.url)) continue;
      sources.links.push({ title: link.title, url: link.url, note: link.note || "" });
      seen.add(link.url);
    }
  }

  if (facts.length) {
    let cursor = 0;
    for (const slide of deck.slides) {
      if (["hero", "closing", "sources", "quote"].includes(slide.layout)) continue;
      const blob = `${slide.title} ${slide.subtitle} ${slide.body} ${slide.bullets.join(" ")}`;
      if (usesFact(blob, facts) || !thin(slide)) continue;
      const fact = facts[cursor++];
      if (!fact) break;
      if (slide.bullets.length < 5) slide.bullets.push(fact.text);
      else slide.body = fact.text;
    }
  }

  return deck;
}

function blankSlide(layout) {
  return {
    layout,
    kicker: "",
    title: "",
    subtitle: "",
    body: "",
    bullets: [],
    aside: "",
    quote: "",
    author: "",
    metrics: [],
    notes: "",
    image: "",
    imageAlt: "",
    links: [],
  };
}

function thin(slide) {
  const text = `${slide.body} ${slide.bullets.join(" ")} ${slide.aside}`.replace(/\s+/g, " ").trim();
  return text.length < 80;
}

function usesFact(blob, facts) {
  const hay = blob.toLowerCase();
  return facts.some((fact) =>
    fact.text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 5)
      .some((word) => hay.includes(word)),
  );
}

function urlPath(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

export function parseModelJson(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("Модель вернула пустой ответ.");
  let raw = text.trim().replace(/^\uFEFF/, "");
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        /* repair happens one level up */
      }
    }
  }
  throw new Error("Модель вернула не JSON.");
}
