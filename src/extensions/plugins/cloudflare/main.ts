import type { ExtensionMain } from "../../core/extension_types";
import { registerCloudflareHandlers } from "./handlers";

/**
 * Cloudflare Pages extension main process entry point
 */
export const main: ExtensionMain = (context) => {
  registerCloudflareHandlers(context);
  context.logger.info("Cloudflare Pages extension loaded");
};
