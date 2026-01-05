import type { ComponentType } from "react";

/**
 * Extension component registry for renderer process
 * Stores React components registered by extensions
 */
class RendererExtensionRegistry {
  private components: Map<string, ComponentType<any>> = new Map();

  /**
   * Register a component with a unique key
   * Key format: {extensionId}:{componentName}
   */
  register(key: string, component: ComponentType<any>): void {
    if (this.components.has(key)) {
      console.warn(
        `Component with key "${key}" is already registered, overwriting`,
      );
    }
    this.components.set(key, component);
  }

  /**
   * Get a component by key
   */
  get(key: string): ComponentType<any> | undefined {
    return this.components.get(key);
  }

  /**
   * Get a component by extension ID and component name
   */
  getComponent(
    extensionId: string,
    componentName: string,
  ): ComponentType<any> | undefined {
    return this.get(`${extensionId}:${componentName}`);
  }

  /**
   * Check if a component is registered
   */
  has(key: string): boolean {
    return this.components.has(key);
  }

  /**
   * Unregister a component
   */
  unregister(key: string): boolean {
    return this.components.delete(key);
  }

  /**
   * Clear all components
   */
  clear(): void {
    this.components.clear();
  }

  /**
   * Get all registered component keys
   */
  getAllKeys(): string[] {
    return Array.from(this.components.keys());
  }
}

// Singleton instance
export const rendererExtensionRegistry = new RendererExtensionRegistry();
