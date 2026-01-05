import type { LoadedExtension } from "./extension_types";

/**
 * Global extension registry
 * Stores all loaded extensions
 */
class ExtensionRegistry {
  private extensions: Map<string, LoadedExtension> = new Map();

  /**
   * Register a loaded extension
   */
  register(extension: LoadedExtension): void {
    if (this.extensions.has(extension.manifest.id)) {
      throw new Error(
        `Extension with id "${extension.manifest.id}" is already registered`,
      );
    }
    this.extensions.set(extension.manifest.id, extension);
  }

  /**
   * Get extension by ID
   */
  get(id: string): LoadedExtension | undefined {
    return this.extensions.get(id);
  }

  /**
   * Get all registered extensions
   */
  getAll(): LoadedExtension[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Check if extension is registered
   */
  has(id: string): boolean {
    return this.extensions.has(id);
  }

  /**
   * Unregister an extension
   */
  unregister(id: string): boolean {
    return this.extensions.delete(id);
  }

  /**
   * Clear all extensions
   */
  clear(): void {
    this.extensions.clear();
  }
}

// Singleton instance
export const extensionRegistry = new ExtensionRegistry();
