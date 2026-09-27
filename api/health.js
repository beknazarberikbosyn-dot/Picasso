import { getHealth } from "../docs/lib/api-routes.js";
import { applyCors } from "../docs/lib/cors.js";

export default function handler(request, response) {
  applyCors(response);
  if (request.method === "OPTIONS") {
    return response.status(204).end();
  }
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Нужен GET." });
  }
  return response.status(200).json(getHealth());
}
