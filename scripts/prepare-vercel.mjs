import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, ".vercel", "output");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, "docs"), path.join(out, "static"), { recursive: true });

writeFileSync(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/api/(.*)", dest: "/api/$1" },
        { handle: "filesystem" },
      ],
    },
    null,
    2,
  ),
);

const vcConfig = {
  runtime: "nodejs20.x",
  handler: "index.js",
  launcherType: "Nodejs",
  shouldAddHelpers: true,
  maxDuration: 60,
};

function writeFunction(name, source) {
  const dir = path.join(out, "functions", "api", `${name}.func`);
  mkdirSync(dir, { recursive: true });
  cpSync(path.join(root, "docs", "lib"), path.join(dir, "lib"), { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(path.join(dir, ".vc-config.json"), JSON.stringify(vcConfig, null, 2));
  writeFileSync(path.join(dir, "index.js"), source);
}

writeFunction(
  "health",
  `import { getHealth } from "./lib/api-routes.js";
import { applyCors } from "./lib/cors.js";

export default function handler(request, response) {
  applyCors(response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") return response.status(405).json({ error: "Нужен GET." });
  return response.status(200).json(getHealth());
}
`,
);

writeFunction(
  "compose",
  `import { apiErrorResponse, postCompose } from "./lib/api-routes.js";
import { applyCors } from "./lib/cors.js";

export default async function handler(request, response) {
  applyCors(response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: "Нужен POST." });
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
    return response.status(200).json(await postCompose(body));
  } catch (error) {
    console.error(error.message);
    const { status, body } = apiErrorResponse(error);
    return response.status(status).json(body);
  }
}
`,
);
