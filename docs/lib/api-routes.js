import { composePresentation } from "./compose.js";
import { serverCredsFromEnv } from "./llm.js";

export function getHealth() {
  const creds = serverCredsFromEnv();
  return {
    ok: true,
    ready: true,
    model: creds.model,
    provider: creds.builtin ? "llm7" : "custom",
    token: Boolean(creds.apiKey),
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
