import fs from "node:fs/promises";
import path from "node:path";

export const NITRO_RULES_START = "<!-- nitro:start -->";
export const NITRO_RULES_END = "<!-- nitro:end -->";

export const NITRO_RULES_SECTION = `${NITRO_RULES_START}

## Nitro Server Layer

This project has a Nitro server layer for backend API routes. A \`nitro.config.ts\` at the app root sets \`serverDir: "./server"\` — do not move or remove it.

### vite.config.ts

\`vite.config.ts\` already imports \`nitro\` from \`"nitro/vite"\` and registers \`nitro()\` as the LAST entry in the \`plugins\` array. Do not move it earlier — it must run after Vite's module-transform middleware, otherwise Nitro's SPA fallback intercepts Vite internal URLs (\`/src/*.tsx\`, \`/@vite/client\`, \`/@react-refresh\`, \`/@fs/*\`) and returns \`index.html\`, breaking the preview.

### API Route Conventions

- Write routes in \`server/routes/api/\` (NEVER top-level \`/api/\`).
- Dynamic routes: \`[param].ts\`. Method-specific: \`hello.get.ts\`, \`hello.post.ts\`.
- Runtime config: \`useRuntimeConfig()\` (env vars prefixed with \`NITRO_\`).

### Imports — read carefully

Imports come from two different sources:

- \`defineHandler\` and \`useRuntimeConfig\` are imported from **\`"nitro"\`**.
- **Every request/response helper comes from \`"nitro/h3"\`** — Nitro v3 re-exports h3 utilities through that subpath. Common ones: \`readBody\`, \`readValidatedBody\`, \`getQuery\`, \`getRouterParam\`, \`getRouterParams\`, \`createError\`, \`sendError\`, \`setResponseStatus\`, \`getRequestHeaders\`, \`getRequestURL\`, \`setCookie\`, \`getCookie\`, \`deleteCookie\`.

Worked example — \`server/routes/api/todos.post.ts\`:

\`\`\`ts
import { defineHandler } from "nitro";
import { readBody, createError } from "nitro/h3";

export default defineHandler(async (event) => {
  const body = await readBody<{ title?: string }>(event);
  if (!body?.title) {
    throw createError({ statusCode: 400, statusMessage: "title is required" });
  }
  return { ok: true, title: body.title };
});
\`\`\`

### Server-side packages

Any package used inside \`server/\` (database drivers like \`@neondatabase/serverless\`, auth SDKs, third-party API clients) must be in \`package.json\`. Add it before writing the first server file that imports it. NEVER import these from \`src/\` — code under \`src/\` ships to the browser, so importing server packages there leaks them and usually breaks the build.

### Common mistakes

- \`import { readBody } from "nitro"\` → wrong. h3 utilities are not exported from \`"nitro"\`. Use \`"nitro/h3"\`.
- \`import { readBody } from "h3"\` → wrong. Even though Nitro is built on h3, you import through \`"nitro/h3"\` (the version Nitro re-exports), not \`"h3"\` directly.
- \`nitro()\` placed before \`react()\` in \`plugins\` → wrong. Must be the LAST entry, otherwise the SPA fallback intercepts Vite internals.
- Omitting \`nitro()\` from \`vite.config.ts\` entirely → \`/api/*\` returns \`index.html\` instead of JSON.
- Importing server-only packages or referencing server-only env vars (\`process.env.DATABASE_URL\`, secrets) from \`src/\` → wrong. The Vite client bundle is public; this leaks them. Server code lives in \`server/\` only.

${NITRO_RULES_END}`;

export interface AiRulesBackup {
  /** Original contents before patching, or null if the file did not exist. */
  backup: string | null;
  /** True if the patcher appended the Nitro section this call. */
  wasAppended: boolean;
}

function aiRulesPath(appPath: string): string {
  return path.join(appPath, "AI_RULES.md");
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Idempotently append the Nitro rules section to `<app>/AI_RULES.md`.
 *
 * - If the file doesn't exist, it's created with just the Nitro section.
 * - If the Nitro markers already exist, the file is left unchanged.
 * - The original file contents are returned for rollback via `restoreAiRules`.
 */
export async function appendNitroRules(
  appPath: string,
): Promise<AiRulesBackup> {
  const filePath = aiRulesPath(appPath);
  const existing = await readIfExists(filePath);

  if (existing !== null && existing.includes(NITRO_RULES_START)) {
    return { backup: existing, wasAppended: false };
  }

  const separator =
    existing === null || existing.length === 0
      ? ""
      : existing.endsWith("\n")
        ? "\n"
        : "\n\n";
  const next = (existing ?? "") + separator + NITRO_RULES_SECTION + "\n";

  await fs.writeFile(filePath, next, "utf8");
  return { backup: existing, wasAppended: true };
}

/**
 * Restore `AI_RULES.md` to the contents captured in a prior `appendNitroRules`
 * call. If the backup is null, the file is deleted (the patcher had created
 * it). Safe to call even if nothing changed.
 */
export async function restoreAiRules(
  appPath: string,
  backup: string | null,
): Promise<void> {
  const filePath = aiRulesPath(appPath);
  if (backup === null) {
    await fs.rm(filePath, { force: true });
    return;
  }
  await fs.writeFile(filePath, backup, "utf8");
}
