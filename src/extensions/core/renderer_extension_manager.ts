/**
 * Renderer Extension Manager
 *
 * Note: In a real implementation, this would need to:
 * 1. Receive extension metadata from main process (via IPC)
 * 2. Dynamically import extension renderer code
 * 3. Register components with the registry
 *
 * For now, extensions manually register their components via the registry.
 * This is a placeholder for future dynamic loading support.
 */

import type { ComponentType } from "react";
import { rendererExtensionRegistry } from "./renderer_extension_registry";

/**
 * Renderer Extension Manager
 * Manages loading and registration of renderer-side extension code
 */
export class RendererExtensionManager {
  private loadedExtensions: Set<string> = new Set();

  /**
   * Register components from an extension
   * This is called by extension renderer code
   */
  registerExtensionComponents(
    extensionId: string,
    components: Record<string, ComponentType<any>>,
  ): void {
    for (const [componentName, component] of Object.entries(components)) {
      const key = `${extensionId}:${componentName}`;
      rendererExtensionRegistry.register(key, component);
    }
    this.loadedExtensions.add(extensionId);
  }

  /**
   * Check if an extension is loaded in renderer
   */
  isExtensionLoaded(extensionId: string): boolean {
    return this.loadedExtensions.has(extensionId);
  }

  /**
   * Get a component by extension ID and component name
   */
  getComponent(
    extensionId: string,
    componentName: string,
  ): ComponentType<any> | undefined {
    return rendererExtensionRegistry.getComponent(extensionId, componentName);
  }
}

// Singleton instance
export const rendererExtensionManager = new RendererExtensionManager();
