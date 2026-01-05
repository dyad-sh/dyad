import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { extensionRegistry } from "@/extensions/core/extension_registry";

const logger = log.scope("extension_handlers");
const handle = createLoggedHandler(logger);

/**
 * IPC handler to list all loaded extensions
 */
async function handleListExtensions() {
  const extensions = extensionRegistry.getAll();

  return extensions.map((ext) => ({
    id: ext.manifest.id,
    name: ext.manifest.name,
    version: ext.manifest.version,
    description: ext.manifest.description,
    ui: ext.manifest.ui,
  }));
}

export function registerExtensionHandlers() {
  handle("extension:list", handleListExtensions);
}
