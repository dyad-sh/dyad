import log from "electron-log";

import {
  decrypt,
  encrypt,
  readSettings,
  writeSettings,
} from "../../main/settings";

import { createTypedHandler } from "./base";
import { cloudflareContracts } from "../types/cloudflare";
import { generateText } from "ai";

import { sanitiseD1DatabaseName } from "@/lib/data_sources/d1_name";
import {
  ProposedSchemaSchema,
  schemaToStatements,
} from "@/lib/data_sources/d1_schema_design";
import { getModelClient } from "../utils/get_model_client";
import { getChatAgentModel } from "@/lib/chat_agent_model";
import {
  createD1ViaToken,
  createD1ViaWrangler,
  detectCloudflareEnvironment,
  ensureWrangler,
  listD1Databases,
  listD1DatabasesViaWrangler,
  applyD1Statements,
  loginWithBrowser,
  run,
} from "../utils/cloudflare/environment";

const logger = log.scope("cloudflare_handlers");

/**
 * The stored API token, decrypted, or null.
 *
 * Only ever called in the main process and never returned through IPC: the
 * renderer is told whether a token exists, never what it is.
 */
export function storedCloudflareToken(): string | null {
  const stored = readSettings().cloudflareApiToken;
  if (!stored) return null;
  try {
    return decrypt(stored);
  } catch {
    // An undecryptable secret is a secret we do not have. Reporting none is
    // better than handing Cloudflare something that cannot work.
    return null;
  }
}

/**
 * What the designer is told about its job.
 *
 * The description is quoted as data rather than pasted into the instructions,
 * because it is user input that may contain anything, including something that
 * reads like an instruction. The model's output is a structure that is then
 * validated, so the worst a hostile description achieves is a bad design the
 * user is shown before anything is created.
 */
const SCHEMA_DESIGNER_PROMPT = [
  "You design SQLite database schemas for Cloudflare D1.",
  "",
  "Reply with JSON only, matching this shape:",
  '{ "summary": string, "tables": [ { "name": string, "description": string,',
  '  "columns": [ { "name": string, "type": "TEXT"|"INTEGER"|"REAL"|"BLOB"|"NUMERIC",',
  '    "nullable": boolean, "primaryKey": boolean, "unique": boolean,',
  '    "description": string, "references": { "table": string, "column": string } | null } ] } ] }',
  "",
  "Rules:",
  "- Table and column names must be plain: letters, digits and underscores only.",
  "- Give every table an INTEGER PRIMARY KEY called id unless the user says otherwise.",
  "- Add created_at as TEXT to tables that record events or records over time.",
  "- Use a junction table for many-to-many relationships.",
  "- Every references.table must be another table in this same design.",
  "- Prefer fewer, clearer tables over an exhaustive model.",
  "- Do not store large binary files; reference them by key or URL instead.",
  "- summary: one or two sentences on what you decided and why.",
].join("\n");

export function registerCloudflareHandlers() {
  createTypedHandler(cloudflareContracts.detectEnvironment, async () => {
    // The app's own directory: the project whose package manager and local
    // wrangler matter here.
    return detectCloudflareEnvironment(process.cwd());
  });

  createTypedHandler(
    cloudflareContracts.listDatabases,
    async (_event, input) => {
      // An empty token means "use the one you remember", so the renderer can ask
      // for a list without ever holding the secret.
      const token = input.apiToken.trim() || storedCloudflareToken();
      if (!token) {
        throw new Error("No Cloudflare API token is stored.");
      }
      return listD1Databases(token);
    },
  );

  createTypedHandler(cloudflareContracts.authState, async () => {
    const environment = await detectCloudflareEnvironment(process.cwd());
    return {
      signedIn: Boolean(environment.account),
      email: environment.account?.email ?? null,
      accountId: environment.account?.accountId ?? null,
      hasStoredToken: Boolean(storedCloudflareToken()),
    };
  });

  createTypedHandler(
    cloudflareContracts.saveApiToken,
    async (_event, input) => {
      writeSettings({ cloudflareApiToken: encrypt(input.apiToken.trim()) });
    },
  );

  createTypedHandler(cloudflareContracts.signOut, async () => {
    writeSettings({ cloudflareApiToken: undefined });
    // Wrangler owns the browser sign-in, so it is the only thing that can
    // forget it. A failure here is not fatal: the token is already gone.
    await run("npx", ["wrangler", "logout"], {
      cwd: process.cwd(),
      timeoutMs: 60_000,
    });
  });

  createTypedHandler(cloudflareContracts.ensureWrangler, async () => ({
    version: await ensureWrangler(process.cwd()),
  }));

  createTypedHandler(cloudflareContracts.loginWithBrowser, async () =>
    loginWithBrowser(process.cwd()),
  );

  createTypedHandler(cloudflareContracts.listSignedInDatabases, async () =>
    listD1DatabasesViaWrangler(process.cwd()),
  );

  createTypedHandler(
    cloudflareContracts.designSchema,
    async (_event, input) => {
      const settings = readSettings();
      const { modelClient } = await getModelClient(
        getChatAgentModel(settings),
        settings,
      );

      const { text } = await generateText({
        model: modelClient.model,
        system: SCHEMA_DESIGNER_PROMPT,
        // Fenced as data: a description is user input and may read like an
        // instruction, and this makes clear which part is which.
        prompt: `Design a database for the following requirement.\n\n<requirement>\n${input.description.trim()}\n</requirement>`,
        maxOutputTokens: 4000,
        temperature: 0.2,
        maxRetries: 1,
      });

      // Models fence JSON in markdown often enough that finding the object is
      // more reliable than insisting they did not.
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start < 0 || end <= start) {
        throw new Error("The designer did not return a database design.");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text.slice(start, end + 1));
      } catch {
        throw new Error(
          "The designer returned something that was not a design.",
        );
      }

      const result = ProposedSchemaSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          "The design was not in a usable shape. Try describing it again.",
        );
      }

      // Rejected here rather than at creation time, remotely.
      schemaToStatements(result.data);
      return result.data;
    },
  );

  createTypedHandler(cloudflareContracts.applySchema, async (_event, input) => {
    const statements = schemaToStatements(input.schema);
    const applied = await applyD1Statements({
      projectRoot: process.cwd(),
      databaseId: input.databaseId,
      statements,
    });
    return { tablesCreated: applied };
  });

  createTypedHandler(
    cloudflareContracts.createDatabase,
    async (_event, input) => {
      // Restricted before it reaches either transport, so the same name is
      // created whichever one runs.
      const name = sanitiseD1DatabaseName(input.name);

      if (input.apiToken && input.accountId) {
        return createD1ViaToken({
          apiToken: input.apiToken,
          accountId: input.accountId,
          name,
        });
      }
      return createD1ViaWrangler({ projectRoot: process.cwd(), name });
    },
  );

  logger.info("Cloudflare handlers registered");
}
