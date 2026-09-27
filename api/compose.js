import { apiErrorResponse, postCompose } from "../docs/lib/api-routes.js";
import { applyCors } from "../docs/lib/cors.js";

export default async function handler(request, response) {
  applyCors(response);
  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Нужен POST." });
  }
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    const result = await postCompose(body);
    return response.status(200).json(result);
  } catch (error) {
    console.error(error.message);
    const { status, body } = apiErrorResponse(error);
    return response.status(status).json(body);
  }
}

export const config = {
  maxDuration: 60,
};
