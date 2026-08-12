import log from "electron-log";

import { createTypedHandler } from "./base";
import { cloudflareContracts } from "../types/cloudflare";
import {
  detectCloudflareEnvironment,
  listD1Databases,
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

  logger.info("Cloudflare handlers registered");
}
