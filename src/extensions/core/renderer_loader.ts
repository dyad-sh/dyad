/**
 * Renderer Extension Loader
 *
 * This module provides utilities to load extension renderer code.
 * Extensions register their components by importing and calling the loader.
 *
 * In the future, this could be enhanced to dynamically load extension code
 * based on metadata from the main process.
 */

import type { ComponentType } from "react";
import { rendererExtensionManager } from "./renderer_extension_manager";

/**
 * Load extension renderer code
 * This should be called by extension renderer entry points
 */
export async function loadExtensionRenderer(
  extensionId: string,
  rendererModule: { renderer?: (context: any) => void | Promise<void> },
): Promise<void> {
  if (
    rendererModule.renderer &&
    typeof rendererModule.renderer === "function"
  ) {
    await rendererModule.renderer({
      extensionId,
      // Additional context can be added here
    });
  }
}

/**
 * Manual registration helper for extensions
 * Extensions can use this to register components directly
 */
export function registerExtensionComponents(
  extensionId: string,
  components: Record<string, ComponentType<any>>,
): void {
  rendererExtensionManager.registerExtensionComponents(extensionId, components);
}
