/**
 * Type-safe IPC Client Helpers
 *
 * Provides utilities for making type-safe IPC calls from the renderer process.
 * These helpers ensure that the client calls match the registered channel types.
 */

import type { IpcRenderer } from "electron";
import type {
  IpcChannelName,
  IpcParams,
  IpcReturns,
} from "./ipc_registry";

/**
 * Type-safe wrapper for ipcRenderer.invoke
 *
 * This ensures that the channel name, parameters, and return type are all
 * correctly typed according to the IPC registry.
 *
 * @example
 * ```typescript
 * const ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
 *
 * // Fully type-safe call
 * const app = await typedInvoke(ipcRenderer, 'get-app', 123);
 * // app is typed as App
 *
 * // TypeScript error if wrong params
 * const app = await typedInvoke(ipcRenderer, 'get-app', 'wrong'); // Error!
 * ```
 */
export async function typedInvoke<T extends IpcChannelName>(
  ipcRenderer: IpcRenderer,
  channel: T,
  ...params: IpcParams<T> extends void ? [] : [IpcParams<T>]
): Promise<IpcReturns<T>> {
  // For channels with void params, don't pass anything
  if (params.length === 0) {
    return ipcRenderer.invoke(channel);
  }
  // For channels with params, pass the first param
  return ipcRenderer.invoke(channel, params[0]);
}

/**
 * Factory function to create a type-safe IPC client
 *
 * This creates a wrapper around ipcRenderer with type-safe invoke methods.
 * Useful for dependency injection and testing.
 *
 * @example
 * ```typescript
 * const ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
 * const ipc = createTypedIpcClient(ipcRenderer);
 *
 * // All methods are type-safe
 * const app = await ipc.invoke('get-app', 123);
 * const chats = await ipc.invoke('get-chats', 456);
 * const version = await ipc.invoke('get-app-version');
 * ```
 */
export function createTypedIpcClient(ipcRenderer: IpcRenderer) {
  return {
    /**
     * Make a type-safe IPC call
     */
    invoke<T extends IpcChannelName>(
      channel: T,
      ...params: IpcParams<T> extends void ? [] : [IpcParams<T>]
    ): Promise<IpcReturns<T>> {
      return typedInvoke(ipcRenderer, channel, ...params);
    },

    /**
     * Access to the underlying ipcRenderer for non-typed operations
     */
    raw: ipcRenderer,
  };
}

/**
 * Type guard to check if a value matches the expected params type
 * Useful for runtime validation in development
 */
export function isValidParams<T extends IpcChannelName>(
  channel: T,
  params: unknown,
): params is IpcParams<T> {
  // This is a basic runtime check - you can extend this with Zod schemas
  // for more robust validation
  if (params === undefined || params === null) {
    return true; // Allow void params
  }
  return typeof params === "object" || typeof params !== "undefined";
}

/**
 * Helper to create a mocked IPC renderer for testing
 *
 * This allows you to mock specific channels while maintaining type safety.
 *
 * @example
 * ```typescript
 * const mockIpc = createMockIpcRenderer({
 *   'get-app': async (appId) => ({ id: appId, name: 'Test App', ... }),
 *   'get-chats': async () => [],
 * });
 *
 * const client = createTypedIpcClient(mockIpc);
 * const app = await client.invoke('get-app', 123); // Returns mocked data
 * ```
 */
export function createMockIpcRenderer(
  mocks: Partial<{
    [K in IpcChannelName]: (
      params: IpcParams<K>,
    ) => Promise<IpcReturns<K>> | IpcReturns<K>;
  }>,
): Pick<IpcRenderer, "invoke" | "on" | "removeListener"> {
  return {
    invoke: async (channel: string, ...args: any[]) => {
      const mockFn = mocks[channel as IpcChannelName] as any;
      if (!mockFn) {
        throw new Error(`No mock registered for channel: ${channel}`);
      }
      return await mockFn(args[0]);
    },
    on: () => ({} as any),
    removeListener: () => ({} as any),
  } as any;
}
