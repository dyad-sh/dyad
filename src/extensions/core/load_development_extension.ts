import type {
  ExtensionManifest,
  ExtensionMain,
  LoadedExtension,
} from "./extension_types";
import { extensionRegistry } from "./extension_registry";
import { createExtensionContext } from "./extension_manager";
import log from "electron-log";

const logger = log.scope("load-development-extension");

/**
 * Load an extension from source code in development mode
 * This allows extensions to be imported statically (as part of the bundle)
 */
export async function loadDevelopmentExtension(
  manifest: ExtensionManifest,
  mainEntry: ExtensionMain | undefined,
  extensionDir: string,
): Promise<void> {
  try {
    // Check if extension is already registered
    if (extensionRegistry.has(manifest.id)) {
      logger.log(`Extension ${manifest.id} is already registered, skipping`);
      return;
    }

    const loadedExtension: LoadedExtension = {
      manifest,
      directory: extensionDir,
      mainEntry: undefined,
      registeredChannels: [],
    };

    // Initialize main process code if provided
    if (mainEntry && manifest.capabilities.hasMainProcess) {
      try {
        // Create context and initialize extension
        const context = createExtensionContext(manifest, extensionDir);
        await mainEntry(context);
        loadedExtension.mainEntry = mainEntry;
        loadedExtension.registeredChannels = context.registeredChannels || [];

        logger.log(
          `Extension ${manifest.id} main process initialized with ${loadedExtension.registeredChannels.length} IPC channels`,
        );
      } catch (error: any) {
        throw new Error(
          `Failed to initialize extension main process: ${error.message}`,
        );
      }
    }

    // Register the extension
    extensionRegistry.register(loadedExtension);
    logger.log(`Successfully loaded development extension: ${manifest.id}`);
  } catch (error: any) {
    logger.error(`Failed to load development extension ${manifest.id}:`, error);
    throw error;
  }
}
