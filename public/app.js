const EXAMPLES = [
  "Питч стартапа для инвесторов: 8 слайдов, уверенно, мало текста, тёмный фон",
  "Урок о Солнечной системе для 5 класса, ярко и понятно",
  "Квартальный отчёт: выручка, три риска и план, спокойная светлая палитра",
  "Доклад про город будущего, вдохновляюще, крупные заголовки с засечками и цитата в середине",
];

const WELCOME = {
  role: "local",
  content:
    "Я Picasso. Опишите тему, аудиторию, число слайдов, цвета и тон. Можно попросить картинки из интернета и ссылки на источники — они останутся на слайдах и в конце колоды. Потом правки тоже идут словами.",
};

const LAYOUTS = new Set(["hero", "section", "bullets", "split", "quote", "metrics", "closing", "sources"]);
const SpeechCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

const state = {
  messages: [WELCOME],
  deck: null,
  index: 0,
  busy: false,
  listening: false,
};

let lang = loadLang();
let recognition = null;
let speechPrefix = "";
let speechRestarts = 0;
let resetArmed = false;
let forceScroll = true;
let showNotes = false;
let toastTimer = 0;

const els = {
  deckName: document.getElementById("deckName"),
  swatches: document.getElementById("swatches"),
  newDeck: document.getElementById("newDeck"),
  present: document.getElementById("present"),
  download: document.getElementById("download"),
  thread: document.getElementById("thread"),
  composer: document.getElementById("composer"),
  prompt: document.getElementById("prompt"),
  mic: document.getElementById("mic"),
  langRu: document.getElementById("langRu"),
  langEn: document.getElementById("langEn"),
  listenLabel: document.getElementById("listenLabel"),
  send: document.getElementById("send"),
  progress: document.getElementById("progress"),
  empty: document.getElementById("empty"),
  chips: document.getElementById("chips"),
  composing: document.getElementById("composing"),
  viewport: document.getElementById("viewport"),
  slideSlot: document.getElementById("slideSlot"),
  strip: document.getElementById("strip"),
  counter: document.getElementById("counter"),
  prev: document.getElementById("prev"),
  next: document.getElementById("next"),
  thumbs: document.getElementById("thumbs"),
  notesBar: document.getElementById("notesBar"),
  notesText: document.getElementById("notesText"),
  notesBody: document.getElementById("notesBody"),
  revise: document.getElementById("revise"),
  toast: document.getElementById("toast"),
  live: document.getElementById("live"),
};

bind();
loadSession();
applyLang();
renderAll();
forgetSavedKey();
new ResizeObserver(() => fit()).observe(els.viewport);

function bind() {
  for (const example of EXAMPLES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = example;
    button.addEventListener("click", () => {
      els.prompt.value = example;
      grow();
      send();
    });
    els.chips.appendChild(button);
  }

  els.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.listening) stopListening(false);
    send();
  });
  els.prompt.addEventListener("input", grow);
  els.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.composer.requestSubmit();
    }
  });
  els.mic.addEventListener("click", () => {
    if (state.listening) stopListening(true);
    else startListening();
  });
  els.langRu.addEventListener("click", () => setLang("ru-RU"));
  els.langEn.addEventListener("click", () => setLang("en-US"));
  els.newDeck.addEventListener("click", resetDeck);
  els.present.addEventListener("click", togglePresent);
  els.download.addEventListener("click", downloadDeck);
  els.prev.addEventListener("click", () => step(-1));
  els.next.addEventListener("click", () => step(1));
  els.revise.addEventListener("click", () => {
    const prefix = `Слайд ${state.index + 1}: `;
    if (!els.prompt.value.startsWith(prefix)) els.prompt.value = prefix;
    grow();
    els.prompt.focus();
  });
  els.viewport.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    if (!document.body.classList.contains("presenting")) return;
    const rect = els.viewport.getBoundingClientRect();
    step(event.clientX - rect.left < rect.width * 0.3 ? -1 : 1);
  });
  document.addEventListener("keydown", onKey);
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
      document.body.classList.remove("presenting", "show-notes");
      fit();
    }
  });
  if (!SpeechCtor) {
    els.mic.disabled = true;
    els.mic.title = "Голос работает в Chrome и Safari";
  }
}

function onKey(event) {
  if (event.key === "Escape") {
    exitPresent();
    return;
  }
  if (event.target.closest("textarea, input")) return;
  if (event.key === "ArrowRight") step(1);
  if (event.key === "ArrowLeft") step(-1);
  if (event.key === "p" || event.key === "P") togglePresent();
  if ((event.key === "s" || event.key === "S") && document.body.classList.contains("presenting")) {
    showNotes = !showNotes;
    document.body.classList.toggle("show-notes", showNotes);
  }
}

function loadLang() {
  try {
    const data = JSON.parse(localStorage.getItem("picasso-settings") || "{}");
    return data.lang === "en-US" ? "en-US" : "ru-RU";
  } catch {
    return "ru-RU";
  }
}

function forgetSavedKey() {
  try {
    const data = JSON.parse(localStorage.getItem("picasso-settings") || "{}");
    if (!data || (!data.apiKey && !data.baseUrl && !data.model)) return;
    localStorage.setItem("picasso-settings", JSON.stringify({ lang }));
  } catch {
    /* private mode */
  }
}

function loadSession() {
  try {
    const data = JSON.parse(localStorage.getItem("picasso-session") || "null");
    if (!data) return;
    if (Array.isArray(data.messages)) {
      const messages = data.messages
        .filter((item) => item && typeof item.content === "string" && ["user", "assistant", "local"].includes(item.role))
        .slice(-40);
      if (messages.length) state.messages = messages;
    }
    if (data.deck && Array.isArray(data.deck.slides) && data.deck.theme?.bg) {
      state.deck = data.deck;
      state.index = Number.isInteger(data.index) ? data.index : 0;
    }
  } catch {
    /* keep the welcome state */
  }
}

function saveSession() {
  try {
    localStorage.setItem(
      "picasso-session",
      JSON.stringify({ messages: state.messages, deck: state.deck, index: state.index }),
    );
  } catch {
    /* private mode or a full disk */
  }
}

function renderAll() {
  paintThread();
  paintStage();
  paintChrome();
  saveSession();
}

function paintThread() {
  const top = els.thread.scrollTop;
  els.thread.replaceChildren();
  const spacer = document.createElement("div");
  spacer.className = "thread-spacer";
  els.thread.appendChild(spacer);
  for (const message of state.messages) {
    const article = document.createElement("article");
    article.className = `msg ${message.role}`;
    article.textContent = message.content;
    els.thread.appendChild(article);
  }
  if (state.busy) {
    const article = document.createElement("article");
    article.className = "msg assistant pending";
    article.textContent = "Собираю слайды…";
    els.thread.appendChild(article);
  }
  els.thread.scrollTop = forceScroll ? els.thread.scrollHeight : top;
  forceScroll = false;
}

function paintStage() {
  const deck = state.deck;
  els.empty.hidden = state.busy || Boolean(deck);
  els.composing.hidden = !(state.busy && !deck);
  els.viewport.hidden = !deck;
  els.strip.hidden = !deck;
  els.notesBar.hidden = !deck;
  if (!deck) return;

  if (state.index >= deck.slides.length) state.index = deck.slides.length - 1;
  if (state.index < 0) state.index = 0;
  const slide = deck.slides[state.index];
  els.slideSlot.innerHTML = slideHtml(slide, state.index, deck.slides.length, deck);
  els.notesBody.textContent = slide.notes || "";
  els.notesText.hidden = !slide.notes;
  els.notesBar.classList.toggle("no-notes", !slide.notes);
  els.counter.textContent = `${state.index + 1} / ${deck.slides.length}`;
  paintThumbs();
  const title = slide.title || deck.title || "";
  els.live.textContent = `Слайд ${state.index + 1} из ${deck.slides.length}. ${title}`;
  requestAnimationFrame(fit);
}

function paintThumbs() {
  els.thumbs.replaceChildren();
  state.deck.slides.forEach((slide, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `thumb${index === state.index ? " is-on" : ""}`;
    button.setAttribute("aria-label", `Слайд ${index + 1}`);
    if (index === state.index) button.setAttribute("aria-current", "true");
    button.innerHTML = slideHtml(slide, index, state.deck.slides.length, state.deck, false);
    button.addEventListener("click", () => {
      state.index = index;
      paintStage();
      paintChrome();
      saveSession();
    });
    els.thumbs.appendChild(button);
  });
  const current = els.thumbs.children[state.index];
  if (!current) return;
  const left = current.offsetLeft - els.thumbs.clientWidth / 2 + current.clientWidth / 2;
  els.thumbs.scrollTo({ left, behavior: "auto" });
}

function paintChrome() {
  const deck = state.deck;
  els.deckName.textContent = deck?.title || "Новая презентация";
  document.title = deck ? `${deck.title} — Picasso` : "Picasso — презентации";
  els.send.textContent = state.busy ? "Собираю…" : "Отправить";
  els.send.disabled = state.busy;
  els.mic.disabled = state.busy || !SpeechCtor;
  els.present.disabled = !deck;
  els.download.disabled = !deck;
  els.prev.disabled = !deck;
  els.next.disabled = !deck;
  els.revise.disabled = !deck;
  els.progress.hidden = !state.busy;
  const colors = [deck?.theme?.bg, deck?.theme?.accent, deck?.theme?.ink];
  els.swatches.hidden = !deck;
  if (deck) {
    els.swatches.querySelectorAll("i").forEach((swatch, index) => {
      swatch.style.background = paint(colors[index], "#ff5a36");
    });
  }
  paintMic();
}

function paintMic() {
  els.mic.setAttribute("aria-pressed", String(state.listening));
  els.mic.setAttribute("aria-label", state.listening ? "Остановить и отправить" : "Говорить");
  els.listenLabel.hidden = !state.listening;
  els.composer.classList.toggle("is-listening", state.listening);
}

function fit() {
  const slide = els.slideSlot.querySelector(".slide");
  if (!slide || els.viewport.hidden) return;
  const rect = els.viewport.getBoundingClientRect();
  const scale = Math.max(0.1, Math.min((rect.width - 48) / 1280, (rect.height - 48) / 720));
  els.slideSlot.style.setProperty("--scale", String(scale));
}

async function send() {
  const text = els.prompt.value.trim();
  if (state.busy) return;
  if (!text) {
    toast("Сначала опишите презентацию.");
    return;
  }

  state.busy = true;
  state.messages.push({ role: "user", content: text });
  els.prompt.value = "";
  grow();
  forceScroll = true;
  renderAll();

  try {
    const response = await fetch("/api/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.messages
          .filter((item) => item.role === "user" || item.role === "assistant")
          .map((item) => ({ role: item.role, content: item.content })),
        deck: state.deck,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Не удалось собрать презентацию.");
    if (!data.deck?.slides?.length) throw new Error("В ответе не было слайдов.");
    state.messages.push({ role: "assistant", content: data.reply || "Презентация готова." });
    state.deck = data.deck;
    state.index = Math.min(state.index, data.deck.slides.length - 1);
    forceScroll = true;
  } catch (error) {
    state.messages.pop();
    els.prompt.value = text;
    grow();
    toast(error.message || "Не получилось собрать презентацию.");
  } finally {
    state.busy = false;
    renderAll();
  }
}

function step(direction) {
  if (!state.deck?.slides?.length) return;
  const count = state.deck.slides.length;
  state.index = (state.index + direction + count) % count;
  paintStage();
  paintChrome();
  saveSession();
}

function resetDeck() {
  const untouched = !state.deck && state.messages.length <= 1;
  if (untouched) return;
  if (!resetArmed) {
    resetArmed = true;
    els.newDeck.textContent = "Точно сбросить?";
    setTimeout(() => {
      resetArmed = false;
      els.newDeck.textContent = "Новая";
    }, 2500);
    return;
  }
  resetArmed = false;
  els.newDeck.textContent = "Новая";
  if (state.listening) stopListening(false);
  state.messages = [WELCOME];
  state.deck = null;
  state.index = 0;
  forceScroll = true;
  exitPresent();
  renderAll();
}

function togglePresent() {
  if (document.body.classList.contains("presenting")) exitPresent();
  else enterPresent();
}

function enterPresent() {
  if (!state.deck) return;
  if (state.listening) stopListening(false);
  document.body.classList.add("presenting");
  document.documentElement.requestFullscreen?.().catch(() => {});
  requestAnimationFrame(fit);
}

function exitPresent() {
  document.body.classList.remove("presenting", "show-notes");
  showNotes = false;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  requestAnimationFrame(fit);
}

async function downloadDeck() {
  if (!state.deck) return;
  try {
    const response = await fetch("/slides.css");
    if (!response.ok) throw new Error("Не удалось прочитать стили слайдов.");
    const css = await response.text();
    const blob = new Blob([standaloneHtml(state.deck, css)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug(state.deck.title)}.html`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    toast(error.message || "Не удалось скачать презентацию.");
  }
}

function setLang(next) {
  lang = next;
  try {
    localStorage.setItem("picasso-settings", JSON.stringify({ lang }));
  } catch {
    /* private mode */
  }
  if (state.listening) stopListening(false);
  applyLang();
}

function applyLang() {
  const russian = lang !== "en-US";
  els.prompt.lang = russian ? "ru" : "en";
  els.langRu.setAttribute("aria-pressed", String(russian));
  els.langEn.setAttribute("aria-pressed", String(!russian));
}

function startListening() {
  if (!SpeechCtor || state.busy) return;
  if (!recognition) recognition = buildRecognition();
  recognition.lang = lang;
  speechPrefix = els.prompt.value.trim();
  speechRestarts = 0;
  state.listening = true;
  paintMic();
  try {
    recognition.start();
  } catch {
    state.listening = false;
    paintMic();
    toast("Не удалось включить микрофон.");
  }
}

function stopListening(andSend) {
  if (!state.listening) return;
  state.listening = false;
  try {
    recognition?.stop();
  } catch {
    /* already stopped */
  }
  paintMic();
  if (!andSend) return;
  if (els.prompt.value.trim()) send();
  else toast("Речь не распознана.");
}

function buildRecognition() {
  const engine = new SpeechCtor();
  engine.interimResults = true;
  engine.continuous = true;
  engine.onresult = (event) => {
    speechRestarts = 0;
    let said = "";
    for (const result of event.results) said += result[0].transcript;
    const spoken = said.trim();
    els.prompt.value = speechPrefix && spoken ? `${speechPrefix} ${spoken}` : spoken || speechPrefix;
    grow();
  };
  engine.onerror = (event) => {
    if (event.error === "aborted" || event.error === "no-speech") return;
    state.listening = false;
    paintMic();
    toast(event.error === "not-allowed" ? "Нет доступа к микрофону." : "Не удалось распознать речь.");
  };
  engine.onend = () => {
    if (!state.listening) return;
    speechRestarts += 1;
    if (speechRestarts > 20) {
      state.listening = false;
      paintMic();
      return;
    }
    try {
      engine.start();
    } catch {
      /* a restart can overlap the previous session */
    }
  };
  return engine;
}

function grow() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 140)}px`;
}

function toast(text) {
  els.toast.hidden = false;
  els.toast.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4200);
}

function slideHtml(slide, index, total, deck, linked = true) {
  const theme = deck.theme || {};
  const bg = paint(theme.bg, "#f6f1e8");
  const ink = paint(theme.ink, "#1c1917");
  const muted = paint(theme.muted, "#6f675f");
  const accent = paint(theme.accent, "#d83c22");
  const soft = paint(theme.accentSoft, "#f3e3dc");
  const font = theme.font === "sans" ? "font-sans" : "font-serif";
  const quote = slide.quote || "";
  const metrics = Array.isArray(slide.metrics) ? slide.metrics.filter((item) => item?.value) : [];
  const bullets = Array.isArray(slide.bullets) ? slide.bullets.filter(Boolean) : [];
  let layout = LAYOUTS.has(slide.layout) ? slide.layout : "bullets";
  if (layout === "metrics" && !metrics.length) layout = bullets.length ? "bullets" : "hero";
  if (layout === "quote" && !quote) layout = "hero";
  if (layout === "split" && !(slide.aside || slide.body || slide.image)) layout = bullets.length ? "bullets" : "hero";
  if (layout === "sources" && !(slide.links || []).length) layout = "closing";

  const number = String(index + 1).padStart(2, "0");
  const totalNumber = String(total).padStart(2, "0");
  const title = slide.title || (index === 0 ? deck.title : "") || "";
  const long = title.length > (layout === "hero" || layout === "closing" ? 32 : 46);
  const titleHtml = `<h2 class="slide-title${long ? " is-long" : ""}">${esc(title)}</h2>`;
  const kicker = slide.kicker ? `<p class="kicker">${esc(slide.kicker)}</p>` : "";
  const subtitle = slide.subtitle ? `<p class="subtitle">${esc(slide.subtitle)}</p>` : "";
  const foot = `<footer class="slide-foot"><span>${esc(deck.title || "")}</span><span>${number} / ${totalNumber}</span></footer>`;
  const mark = `<div class="mark" aria-hidden="true"><i></i><i></i><i></i></div>`;
  const style = `--bg:${bg};--ink:${ink};--muted:${muted};--accent:${accent};--soft:${soft}`;
  const photo = slide.image
    ? `<img class="slide-photo" src="${esc(slide.image)}" alt="${esc(slide.imageAlt || "")}" />`
    : "";
  const photoClass = slide.image ? " has-photo" : "";
  let inner = "";

  if (layout === "sources") {
    inner = `<div class="hero-copy">${kicker}${titleHtml}${subtitle}${linksHtml(slide.links, linked)}</div>${foot}`;
  } else if (layout === "hero" || layout === "section") {
    inner = `${photo}${layout === "hero" ? mark : `<p class="ghost-num">${number}</p>`}<div class="hero-copy">${kicker}${titleHtml}${subtitle}</div>${foot}`;
  } else if (layout === "closing") {
    inner = `<div class="hero-copy"><span class="bar"></span>${kicker}${titleHtml}${subtitle}</div>${foot}`;
  } else if (layout === "quote") {
    const kick = slide.kicker || slide.title;
    const quoteClass = quote.length > 120 ? " is-long" : "";
    inner = `<div class="hero-copy">${kick ? `<p class="kicker">${esc(kick)}</p>` : ""}<p class="quote-mark" aria-hidden="true">«</p><blockquote class="${quoteClass.trim()}">${esc(quote)}</blockquote>${slide.author ? `<p class="author">${esc(slide.author)}</p>` : ""}</div>${foot}`;
  } else if (layout === "metrics") {
    const cells = metrics
      .map((item) => {
        const valueClass = String(item.value).length > 6 ? " is-long" : "";
        return `<div class="metric"><strong class="${valueClass.trim()}">${esc(item.value)}</strong><span>${esc(item.label || "")}</span></div>`;
      })
      .join("");
    inner = `${kicker}${titleHtml}<div class="metric-row" style="--cols:${metrics.length}">${cells}</div>${foot}`;
  } else if (layout === "split" || (slide.image && layout === "bullets")) {
    const copy = `${kicker}${titleHtml}${pointsHtml(bullets)}`;
    const side = slide.image
      ? `<figure class="photo-frame">${photo}${slide.imageAlt ? `<figcaption>${esc(slide.imageAlt)}</figcaption>` : ""}</figure>`
      : `<aside class="aside">${esc(slide.aside || slide.body || "")}</aside>`;
    inner = `<div class="split-grid"><div>${copy}</div>${side}</div>${foot}`;
    layout = "split";
  } else {
    const lede = slide.body ? `<p class="lede">${esc(slide.body)}</p>` : "";
    inner = `${kicker}${titleHtml}${lede}${pointsHtml(bullets)}${foot}`;
  }

  return `<article class="slide layout-${layout} ${font}${photoClass}" style="${style}" aria-label="${esc(`Слайд ${index + 1}. ${title}`)}">${inner}</article>`;
}

function linksHtml(links, linked) {
  const items = (links || []).filter((link) => link?.url);
  if (!items.length) return "";
  return `<ul class="sources">${items
    .map((link) => {
      const label = esc(link.title || link.url);
      const note = link.note ? `<span>${esc(link.note)}</span>` : "";
      const body = linked
        ? `<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${label}</a>${note}`
        : `<span class="source-name">${label}</span>${note}`;
      return `<li>${body}</li>`;
    })
    .join("")}</ul>`;
}

function pointsHtml(bullets) {
  if (!bullets.length) return "";
  return `<ul class="points">${bullets.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function standaloneHtml(deck, css) {
  const slides = deck.slides.map((slide, index) => slideHtml(slide, index, deck.slides.length, deck)).join("");
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(deck.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,560;0,9..144,680;1,9..144,560&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    ${css}
    html, body { height: 100%; margin: 0; background: #141210; }
    body { display: grid; place-items: center; }
    #stack { position: relative; width: calc(1280px * var(--scale, 1)); height: calc(720px * var(--scale, 1)); }
    .slide { display: none; }
    .slide.is-on { display: block; position: absolute; top: 0; left: 0; transform: scale(var(--scale, 1)); transform-origin: top left; }
  </style>
</head>
<body>
  <div id="stack">${slides}</div>
  <script>
    const slides = [...document.querySelectorAll(".slide")];
    let index = 0;
    const fit = () => {
      const scale = Math.max(0.1, Math.min((innerWidth - 32) / 1280, (innerHeight - 32) / 720));
      document.documentElement.style.setProperty("--scale", scale);
    };
    const show = (next) => {
      index = (next + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => slide.classList.toggle("is-on", slideIndex === index));
    };
    addEventListener("resize", fit);
    addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === " ") show(index + 1);
      if (event.key === "ArrowLeft") show(index - 1);
    });
    addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      show(event.clientX < innerWidth * 0.3 ? index - 1 : index + 1);
    });
    fit();
    show(0);
  </script>
</body>
</html>`;
}

function paint(color, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : fallback;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function slug(value) {
  return (
    String(value || "picasso")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "picasso"
  );
}
