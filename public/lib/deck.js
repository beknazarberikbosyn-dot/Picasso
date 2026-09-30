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

// Модели часто кладут текст не в bullets/body, а в content, text, points и т. п.
// Раньше такие поля отбрасывались, и на слайде оставался только заголовок.
const BULLET_KEYS = ["bullets", "points", "items", "list", "bulletPoints", "bullet_points", "keyPoints", "key_points", "facts", "content"];
const BODY_KEYS = ["body", "text", "description", "paragraph", "content", "details", "summary", "caption"];

function itemText(item) {
  if (typeof item === "string" || typeof item === "number") return String(item);
  if (!item || typeof item !== "object") return "";
  const head = asText(item.title || item.heading || item.label || item.name, 80);
  const tail = asText(item.text || item.body || item.description || item.content || item.value || item.detail, 240);
  if (head && tail) return `${head}: ${tail}`;
  return head || tail;
}

function pickBullets(source) {
  for (const key of BULLET_KEYS) {
    const value = source[key];
    if (Array.isArray(value) && value.length) {
      const list = value.map((item) => asText(itemText(item), 240)).filter(Boolean);
      if (list.length) return list.slice(0, 5);
    }
  }
  return [];
}

function pickBody(source) {
  for (const key of BODY_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value) && value.every((item) => typeof item === "string") && value.length === 1) return value[0];
  }
  return "";
}

function pickImage(source) {
  const value = source.image || source.imageUrl || source.image_url || source.photo || source.picture;
  if (value && typeof value === "object") return value.url || value.src || "";
  return value;
}

function normalizeSlide(raw, index) {
  const source =
    typeof raw === "string" ? { title: raw } : raw && typeof raw === "object" ? raw : {};
  let bullets = pickBullets(source);
  let bodyRaw = pickBody(source);
  // Если текст пришёл одной строкой с переносами или маркерами, превращаем его в пункты.
  if (!bullets.length && typeof bodyRaw === "string" && /\n\s*(?:[-•*–—]|\d+[.)])\s+/.test(`\n${bodyRaw}`)) {
    const lines = bodyRaw
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:[-•*–—]|\d+[.)])\s+/, "").trim())
      .filter(Boolean);
    if (lines.length >= 2) {
      bullets = lines.map((line) => asText(line, 240)).slice(0, 5);
      bodyRaw = "";
    }
  }
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
    kicker: asText(source.kicker || source.eyebrow || source.label, 48),
    title: asText(source.title || source.heading || source.header || source.name, 140),
    subtitle: asText(source.subtitle || source.subheading || source.tagline, 280),
    body: asText(bodyRaw, 560),
    bullets,
    aside: asText(source.aside || source.sidebar || source.note, 360),
    quote: asText(source.quote, 320),
    author: asText(source.author, 80),
    metrics,
    notes: asText(source.notes, 500),
    image: httpsUrl(pickImage(source)),
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
  let root = input.deck || input.presentation || input;
  if (Array.isArray(root)) root = { slides: root };
  if (!root || typeof root !== "object") throw new Error("В ответе не было презентации.");
  const slides = (Array.isArray(root.slides) ? root.slides : Array.isArray(root.pages) ? root.pages : [])
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

  if (!flags.dark && luma(deck.theme.bg) < 0.42) {
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
    deck.slides = deck.slides.filter((slide) => slide !== sources);
    deck.slides.push(sources);
  }

  if (facts.length) {
    const hero = deck.slides.find((slide) => slide.layout === "hero");
    if (hero && (!hero.subtitle || vague(hero.subtitle))) hero.subtitle = sentences(facts[0].text)[0].slice(0, 220);
    // Общий запас предложений из всех фактов: раздаём их по пустым слайдам без повторов.
    const heroText = hero?.subtitle || "";
    let pool = facts.flatMap((fact) => sentences(fact.text)).filter((part) => !heroText.includes(part.slice(0, 40)));
    if (!pool.length) pool = facts.flatMap((fact) => sentences(fact.text));
    let cursor = 0;
    const take = (count) => {
      const picked = [];
      for (let step = 0; step < count && step < pool.length; step += 1) {
        picked.push(pool[cursor % pool.length]);
        cursor += 1;
      }
      return picked;
    };
    for (const slide of deck.slides) {
      if (["hero", "closing", "sources", "quote", "metrics"].includes(slide.layout)) continue;
      const blob = `${slide.title} ${slide.subtitle} ${slide.body} ${slide.bullets.join(" ")}`;
      if (usesFact(blob, facts) && !thin(slide)) continue;
      const kept = slide.bullets.filter((item) => !vague(item));
      if (kept.length < 2) {
        // Пустой слайд: добавляем реальные факты пунктами, чтобы не было одного заголовка.
        const extra = take(Math.max(1, Math.min(3, Math.ceil(pool.length / 2))));
        slide.bullets = [...kept, ...extra.filter((item) => !kept.includes(item))].slice(0, 4);
        if (vague(slide.body)) slide.body = "";
      } else {
        const [extra] = take(1);
        if (extra && !slide.bullets.includes(extra)) slide.bullets = [...kept, extra].slice(0, 5);
      }
      // У section на слайде виден только заголовок, поэтому слайд с текстом делаем списком.
      if (slide.layout === "section") slide.layout = slide.image ? "split" : "bullets";
    }
  }

  return deck;
}

const CONTENT_LAYOUTS = new Set(["section", "bullets", "split"]);

/** Слайды в середине колоды, где кроме заголовка почти ничего нет. */
export function emptySlides(deck) {
  return deck.slides.filter((slide, index) => {
    if (index === 0 || !CONTENT_LAYOUTS.has(slide.layout)) return false;
    const text = `${slide.body} ${slide.bullets.join(" ")} ${slide.aside}`.replace(/\s+/g, " ").trim();
    return text.length < 40;
  });
}

/** true, если модель вернула «скелет»: много слайдов с одним заголовком. */
export function deckLooksEmpty(deck) {
  const middle = deck.slides.filter((slide, index) => index > 0 && CONTENT_LAYOUTS.has(slide.layout));
  if (!middle.length) return deck.slides.length > 2;
  return emptySlides(deck).length >= Math.max(1, Math.ceil(middle.length / 2));
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

function sentences(text) {
  const parts = String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-ZА-ЯЁ0-9«"])/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20)
    .map((part) => part.slice(0, 240));
  return parts.length ? parts : [String(text || "").slice(0, 240)];
}

function thin(slide) {
  const text = `${slide.body} ${slide.bullets.join(" ")} ${slide.aside}`.replace(/\s+/g, " ").trim();
  return text.length < 80 || vague(text);
}

function vague(text) {
  return /это не просто|в современном мире|откройте для себя|путешествие в мир|играет важную роль|нельзя недооценивать|уникальн\p{L}*|инновац\p{L}*|искусство и вкус/iu.test(
    String(text || ""),
  );
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
