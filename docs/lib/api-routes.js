import { composePresentation } from "./compose.js";
import { planLimits, serverCredsFromEnv } from "./llm.js";

export function getHealth() {
  const creds = serverCredsFromEnv();
  const chain = [creds, ...(creds.fallbacks || [])];
  return {
    ok: true,
    ready: true,
    model: creds.model,
    provider: creds.provider || (creds.builtin ? "llm7" : "custom"),
    // Порядок, в котором сайт пробует модели: основная, затем запасные.
    providers: chain.map((item) => ({ provider: item.provider, model: item.model, key: Boolean(item.apiKey) })),
    token: chain.some((item) => item.provider === "llm7" && item.apiKey),
    limits: planLimits(creds),
  };
}

export async function postCompose(body) {
  const creds = serverCredsFromEnv();
  if (!creds.apiKey && !creds.builtin) {
    const error = new Error("Модель на сервере не настроена.");
    error.status = 500;
    throw error;
  }
  return composePresentation(body, creds);
}

export function apiErrorResponse(error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  return {
    status: status >= 400 && status < 600 ? status : 500,
    body: { error: error.message || "Не получилось собрать презентацию." },
  };
}
