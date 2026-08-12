import log from "electron-log";

import { createTypedHandler } from "./base";
import { cloudflareContracts } from "../types/cloudflare";
import {
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

  logger.info("Cloudflare handlers registered");
}
