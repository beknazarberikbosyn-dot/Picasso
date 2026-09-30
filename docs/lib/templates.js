// Шаблоны оформления. Каждый задаёт свои шрифты, размер текста и место фотографии
// (это в slides.css, классы .tpl-*), а цвета строит из оттенка, подобранного под тему.

export const TEMPLATES = [
  {
    id: "editorial",
    name: "Журнал",
    description: "Засечки, фото на весь экран, спокойный тёплый фон",
    hint: "Редакционная подача: цельные абзацы, одна мысль на слайд, уместна цитата.",
    build: (h, h2) => ({ bg: hsl(h, 32, 95), ink: hsl(h, 30, 11), accent: hsl(h, 70, 38), font: "serif" }),
  },
  {
    id: "swiss",
    name: "Швейцарский",
    description: "Строгая сетка, жирный гротеск, фото слева",
    hint: "Деловая подача: короткие пункты, числа и факты, слайд с метриками.",
    build: (h, h2) => ({ bg: hsl(h, 12, 98), ink: hsl(h, 20, 10), accent: hsl(h, 85, 42), font: "sans" }),
  },
  {
    id: "poster",
    name: "Плакат",
    description: "Огромные заголовки капсом, яркий цветной фон",
    hint: "Плакатная подача: очень короткие заголовки, крупные числа, минимум текста.",
    build: (h, h2) => ({ bg: hsl(h, 55, 90), ink: hsl(h, 60, 10), accent: hsl(h2, 85, 36), font: "sans" }),
  },
  {
    id: "minimal",
    name: "Минимализм",
    description: "Много воздуха, тонкий шрифт, небольшое фото",
    hint: "Минималистичная подача: мало текста, по три пункта, тихий тон.",
    build: (h, h2) => ({ bg: hsl(h, 14, 97), ink: hsl(h, 12, 16), accent: hsl(h, 45, 42), font: "sans" }),
  },
  {
    id: "neon",
    name: "Неон",
    description: "Тёмный фон, светящийся акцент, техно-сетка",
    hint: "Технологичная подача: точные термины, цифры, схемы процесса по шагам.",
    build: (h, h2) => ({ mode: "dark", bg: hsl(h, 40, 8), ink: hsl(h, 20, 94), accent: hsl(h2, 95, 62), font: "sans" }),
  },
  {
    id: "playful",
    name: "Яркий",
    description: "Округлый шрифт, карточки, фото с наклоном",
    hint: "Живая подача для школы и широкой аудитории: простые слова, вопросы, яркие примеры.",
    build: (h, h2) => ({ bg: hsl(h2, 85, 95), ink: hsl(h, 50, 15), accent: hsl(h, 85, 45), font: "sans" }),
  },
];

const IDS = new Set(TEMPLATES.map((template) => template.id));

export function isTemplate(id) {
  return IDS.has(id);
}

export function templateById(id) {
  return TEMPLATES.find((template) => template.id === id) || TEMPLATES[0];
}

// Темы → основной и дополнительный оттенок (градусы HSL) и какие шаблоны подходят первыми.
const TOPICS = [
  { re: /космос|планет|солнечн|звезд|звёзд|галакт|астроном|вселенн|луна|марс|ракет|space|planet|galax|astronom/iu, hues: [232, 280], order: ["neon", "poster", "editorial"] },
  { re: /искусствен\p{L}*\s+интеллект|нейросет|(?<!\p{L})ии(?!\p{L})|программ|компьютер|технолог|цифров|робот|кибер|данн\p{L}*|алгоритм|интернет|стартап|(?<!\p{L})ai(?!\p{L})|tech|software|code|robot|crypto|блокчейн/iu, hues: [215, 175], order: ["neon", "swiss", "minimal"] },
  { re: /природ|эколог|лес|растен|животн|климат|биолог|сад|цвет[оы]|nature|forest|climate|ecolog|plant|animal/iu, hues: [140, 45], order: ["editorial", "playful", "minimal"] },
  { re: /океан|мор[еяю]|вод[аыу]|рек[аи]|озер|кит|рыб|ocean|sea|water|river|lake/iu, hues: [195, 25], order: ["editorial", "minimal", "playful"] },
  { re: /истори|древн|войн|импер|царь|хан|(?<!\p{L})век(?:а|е|у|ов)?(?!\p{L})|средневек|археолог|революц|музей|history|ancient|empire|war(?!\p{L})|medieval/iu, hues: [28, 355], order: ["editorial", "minimal", "swiss"] },
  { re: /казахстан|астан|алмат|байтерек|степ|kazakh/iu, hues: [196, 45], order: ["editorial", "swiss", "poster"] },
  { re: /бизнес|финанс|экономик|рынок|продаж|отч[её]т|выручк|инвест|банк|маркетинг|компани|business|financ|market|sales|report|invest/iu, hues: [218, 40], order: ["swiss", "minimal", "neon"] },
  { re: /медицин|здоров|врач|болезн|вирус|анатом|спорт\p{L}*\s+питан|health|medic|doctor|virus/iu, hues: [175, 355], order: ["minimal", "swiss", "playful"] },
  { re: /еда|кухн|рецепт|кофе|вино|блюд|ресторан|food|cook|recipe|coffee|cuisine/iu, hues: [22, 95], order: ["editorial", "playful", "poster"] },
  { re: /музык|кино|фильм|живопис|художник|искусств|театр|дизайн|мода|music|film|movie|(?<!\p{L})art(?!\p{L})|painting|theatre|fashion|design/iu, hues: [330, 45], order: ["poster", "editorial", "minimal"] },
  { re: /спорт|футбол|олимп|бег|баскетбол|хоккей|sport|football|soccer|olymp/iu, hues: [8, 210], order: ["poster", "swiss", "playful"] },
  { re: /урок|школ|класс|дет(?:и|ск|ей)|учени|образован|school|kids|lesson|class(?!\p{L})/iu, hues: [45, 200], order: ["playful", "poster", "editorial"] },
  { re: /город|архитектур|здани|урбан|мост|city|architect|urban|building/iu, hues: [210, 20], order: ["swiss", "minimal", "editorial"] },
  { re: /физик|хими|математ|наук|исследован|атом|энерг|physics|chemi|math|science|research|energy/iu, hues: [250, 170], order: ["neon", "swiss", "minimal"] },
];

export function topicStyle(text) {
  const value = String(text || "");
  const found = TOPICS.find((topic) => topic.re.test(value));
  if (found) return { hue: found.hues[0], hue2: found.hues[1], order: found.order };
  // Незнакомая тема: оттенок стабильно выводится из текста, чтобы у разных тем были разные цвета.
  let hash = 0;
  for (const char of value.toLowerCase()) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  const hue = hash % 360;
  return { hue, hue2: (hue + 150) % 360, order: ["editorial", "swiss", "minimal"] };
}

/** Шаблоны в порядке уместности для темы: подходящие первыми. */
export function recommendTemplates(text) {
  const { order } = topicStyle(text);
  return [...order, ...TEMPLATES.map((template) => template.id).filter((id) => !order.includes(id))];
}

/** Сырые цвета шаблона для темы (потом их выравнивает normalizeTheme по контрасту). */
export function templateTheme(id, text) {
  const { hue, hue2 } = topicStyle(text);
  const theme = templateById(id).build(hue, hue2);
  return { mode: theme.mode || "light", ...theme };
}

function hsl(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)]
    .map((part) => Math.round(part * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}
