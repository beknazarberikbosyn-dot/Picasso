const BUILTIN_BASE = "https://api.llm7.io/v1";
const BUILTIN_MODEL = "codestral-latest";

function completionsUrl(baseUrl) {
  if (/\/(?:openai|chat\/completions)$/.test(baseUrl)) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeBase(value) {
  let url;
  try {
    url = new URL(value);
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

export function resolveCreds(env = {}) {
  const customBase = (env.baseUrl || "").trim().replace(/\/$/, "");
  const customKey = (env.apiKey || "").trim();
  const customModel = (env.model || "").trim();
  if (!customBase && !customKey) {
    return { baseUrl: BUILTIN_BASE, model: customModel || BUILTIN_MODEL, apiKey: "", builtin: true };
  }
  const baseUrl = safeBase(customBase || "https://api.openai.com/v1");
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl);
  let apiKey = customKey;
  if (!apiKey && local) apiKey = "ollama";
  return {
    baseUrl,
    model: (customModel || "gpt-4o-mini").slice(0, 120),
    apiKey,
    builtin: false,
  };
}

export function serverCredsFromEnv() {
  return resolveCreds({
    baseUrl: process.env.OPENAI_BASE_URL || "",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "",
  });
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

export async function completeRespectingLimit(creds, messages) {
  try {
    return await complete(creds, messages);
  } catch (error) {
    if (error.status !== 429 || !creds.builtin) throw error;
    await delay(16000);
    return await complete(creds, messages);
  }
}
