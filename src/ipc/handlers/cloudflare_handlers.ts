import log from "electron-log";

import {
  decrypt,
  encrypt,
  readSettings,
  writeSettings,
} from "../../main/settings";

import { createTypedHandler } from "./base";
import { cloudflareContracts } from "../types/cloudflare";
import { sanitiseD1DatabaseName } from "@/lib/data_sources/d1_name";
import {
  createD1ViaToken,
  createD1ViaWrangler,
  detectCloudflareEnvironment,
  ensureWrangler,
  listD1Databases,
  listD1DatabasesViaWrangler,
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
