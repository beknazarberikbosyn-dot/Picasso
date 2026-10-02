const BUILTIN_BASE = "https://api.llm7.io/v1";
const BUILTIN_MODEL = "codestral-latest";
// Gemini через OpenAI-совместимый адрес Google (ai.google.dev/gemini-api/docs/openai).
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_MODEL = "gemini-2.5-flash";

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
    // Без токена llm7.io даёт ~10 запросов в минуту на IP, а у Vercel IP общие —
    // лимит быстро кончается. Бесплатный токен (LLM7_TOKEN) поднимает лимит.
    const token = (env.llm7Token || "").trim();
    return { baseUrl: BUILTIN_BASE, model: customModel || BUILTIN_MODEL, apiKey: token, builtin: true, provider: "llm7" };
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
    provider: "custom",
  };
}

export function serverCredsFromEnv() {
  const base = resolveCreds({
    baseUrl: process.env.OPENAI_BASE_URL || "",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "",
    llm7Token: process.env.LLM7_TOKEN || "",
  });
  const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!geminiKey) return base;
  // Основная модель — Gemini. Прежняя модель (LLM7 или своя) остаётся запасной:
  // к ней сайт переходит сам, если у Gemini кончился лимит или он недоступен.
  const perDay = Number(process.env.GEMINI_RPD);
  return {
    baseUrl: GEMINI_BASE,
    model: (process.env.GEMINI_MODEL || "").trim().slice(0, 120) || GEMINI_MODEL,
    apiKey: geminiKey,
    builtin: false,
    provider: "gemini",
    requestsPerDay: Number.isFinite(perDay) && perDay > 0 ? Math.round(perDay) : null,
    fallbacks: base.apiKey || base.builtin ? [base] : [],
  };
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
        temperature: 0.4,
        messages,
        ...extra,
      }),
      // Если есть запасная модель, не ждём основную дольше 35 секунд — иначе не уложимся в лимит Vercel.
      signal: AbortSignal.timeout(creds.fallbacks?.length ? 35000 : 90000),
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
    if (response.status === 429) {
      message = creds.builtin && !creds.apiKey
        ? "Бесплатный лимит модели исчерпан (общий для всех без токена). Подождите минуту и отправьте ещё раз."
        : "Лимит запросов к модели исчерпан. Подождите минуту и отправьте ещё раз.";
    }
    if (response.status >= 500) message = "Модель сейчас недоступна. Попробуйте ещё раз через минуту.";
    const error = new Error(message);
    error.status = response.status >= 500 ? 502 : response.status;
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfter = retryAfter;
    throw error;
  }

  const data = await response.json();
  recordUsage(creds, data, response.headers);
  const text = data.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    const error = new Error("Модель вернула пустой ответ.");
    error.status = 502;
    throw error;
  }
  return text;
}

// Лимиты llm7.io за сутки и за час (docs.llm7.io/limits). API остатка у llm7 нет,
// поэтому сайт сам считает потраченные токены по полю usage в ответах модели.
// У Gemini лимит считается в запросах за сутки и зависит от модели и аккаунта
// (точные числа — в Google AI Studio), поэтому его можно задать в GEMINI_RPD.
export function planLimits(creds, provider) {
  const chain = [creds, ...(creds?.fallbacks || [])].filter(Boolean);
  const active = chain.find((item) => item.provider === provider) || chain[0];
  if (!active) return null;
  if (active.provider === "gemini") {
    return { plan: "gemini", provider: "gemini", model: active.model, requestsPerDay: active.requestsPerDay || null };
  }
  if (!active.builtin) return { plan: "custom", provider: "custom", model: active.model };
  return active.apiKey
    ? { plan: "free-token", provider: "llm7", model: active.model, tokensPerDay: 1000000, requestsPerHour: 100 }
    : { plan: "anonymous", provider: "llm7", model: active.model, tokensPerDay: 500000, requestsPerHour: 60 };
}

function recordUsage(creds, data, headers) {
  const meter = creds.meter;
  if (!meter) return;
  meter.calls += 1;
  meter.provider = creds.provider || (creds.builtin ? "llm7" : "custom");
  const usage = data?.usage || {};
  const total = Number(usage.total_tokens) || (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0);
  if (Number.isFinite(total)) meter.tokens += total;
  // Если провайдер присылает остаток в заголовках (как OpenAI), берём точные числа.
  const read = (...names) => {
    for (const name of names) {
      const value = Number(headers?.get?.(name));
      if (headers?.get?.(name) != null && Number.isFinite(value)) return value;
    }
    return null;
  };
  const remainingTokens = read("x-ratelimit-remaining-tokens", "x-ratelimit-remaining-tokens-day", "ratelimit-remaining-tokens");
  const remainingRequests = read("x-ratelimit-remaining-requests", "x-ratelimit-remaining", "ratelimit-remaining");
  if (remainingTokens != null) meter.remainingTokens = remainingTokens;
  if (remainingRequests != null) meter.remainingRequests = remainingRequests;
}

async function complete(creds, messages) {
  const hosted = /api\.openai\.com|openrouter\.ai|api\.llm7\.io/.test(creds.baseUrl);
  let attempts;
  if (creds.provider === "gemini") {
    // «Размышления» Gemini тратят те же max_tokens, что и ответ, и JSON обрывается.
    // У 2.5 их можно выключить (none); у 3.x нельзя — тогда low и запас по токенам.
    attempts = [
      { response_format: { type: "json_object" }, max_tokens: 8192, reasoning_effort: "none" },
      { response_format: { type: "json_object" }, max_tokens: 12000, reasoning_effort: "low" },
      { max_tokens: 12000 },
    ];
  } else if (creds.builtin || hosted) {
    attempts = [{ response_format: { type: "json_object" }, max_tokens: 4096 }, { max_tokens: 4096 }];
  } else {
    attempts = [{ max_tokens: 4096 }, { max_completion_tokens: 4096 }];
  }
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
  // Цепочка: основная модель, затем запасные. К следующей переходим, когда у текущей
  // кончился лимит, отклонён ключ, нет такой модели или она недоступна.
  const chain = [creds, ...(creds.fallbacks || []).map((item) => ({ ...item, meter: creds.meter }))];
  let lastError;
  for (let index = 0; index < chain.length; index += 1) {
    const current = chain[index];
    const last = index === chain.length - 1;
    // Запасной модели не ставим короткий таймаут основной.
    const target = last ? { ...current, fallbacks: [] } : current;
    try {
      return await complete(target, messages);
    } catch (error) {
      lastError = error;
      if (creds.meter) {
        creds.meter.skipped = [...(creds.meter.skipped || []), { provider: current.provider, status: error.status }];
      }
      if (!last) continue;
      if (error.status !== 429) throw error;
      // Одна повторная попытка. Ждём не дольше 12 секунд, чтобы уложиться в лимит функции Vercel.
      await delay(Math.min(12, error.retryAfter || 8) * 1000);
      return await complete(target, messages);
    }
  }
  throw lastError;
}
