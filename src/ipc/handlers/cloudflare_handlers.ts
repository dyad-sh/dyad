import log from "electron-log";

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
} from "../utils/cloudflare/environment";

const logger = log.scope("cloudflare_handlers");

export function registerCloudflareHandlers() {
  createTypedHandler(cloudflareContracts.detectEnvironment, async () => {
    // The app's own directory: the project whose package manager and local
    // wrangler matter here.
    return detectCloudflareEnvironment(process.cwd());
  });

  createTypedHandler(cloudflareContracts.listDatabases, async (_event, input) =>
    listD1Databases(input.apiToken),
  );

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
