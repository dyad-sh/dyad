import type { ExtensionRenderer } from "../../core/extension_types";
import { rendererExtensionManager } from "../../core/renderer_extension_manager";
import { CloudflareConnector, CloudflareSettings } from "./components";

/**
 * Cloudflare Pages extension renderer process entry point
 */
export const renderer: ExtensionRenderer = (context) => {
  // Register components with the renderer extension manager
  rendererExtensionManager.registerExtensionComponents(context.extensionId, {
    CloudflareConnector,
    CloudflareSettings,
  });
};
