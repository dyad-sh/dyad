/**
 * Type-safe IPC Handler Utilities
 *
 * Provides utilities for creating type-safe IPC handlers with automatic
 * logging, error handling, and type validation.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { LogFunctions } from "electron-log";
import type {
  IpcChannelName,
  IpcParams,
  IpcReturns,
} from "./ipc_registry";

/**
 * Handler function type with proper typing from registry
 */
export type IpcHandlerFn<T extends IpcChannelName> = (
  event: IpcMainInvokeEvent,
  params: IpcParams<T>,
) => Promise<IpcReturns<T>> | IpcReturns<T>;

/**
 * Configuration options for IPC handlers
 */
export interface IpcHandlerOptions {
  /**
   * Custom logger instance. If not provided, no logging will occur.
   */
  logger?: LogFunctions;

  /**
   * Whether to log handler calls and responses (default: true if logger provided)
   */
  enableLogging?: boolean;

  /**
   * Whether to log full arguments and returns (default: false for security/performance)
   */
  logDetails?: boolean;

  /**
   * Custom error handler. If not provided, errors are re-thrown with channel prefix.
   */
  onError?: (channel: string, error: unknown, args: any[]) => void;
}

/**
 * Creates a type-safe IPC handler with automatic logging and error handling
 *
 * @param channel - The IPC channel name (must be in registry)
 * @param handler - The handler function with typed parameters and return
 * @param options - Optional configuration for logging and error handling
 *
 * @example
 * ```typescript
 * createIpcHandler('create-app', async (event, params) => {
 *   // params is typed as CreateAppParams
 *   // return type is enforced as CreateAppResult
 *   const result = await createAppLogic(params);
 *   return result;
 * }, { logger });
 * ```
 */
export function createIpcHandler<T extends IpcChannelName>(
  channel: T,
  handler: IpcHandlerFn<T>,
  options: IpcHandlerOptions = {},
): void {
  const {
    logger,
    enableLogging = !!logger,
    logDetails = false,
    onError,
  } = options;

  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: any[]) => {
    // Extract params (first arg for all our handlers)
    const params = args[0] as IpcParams<T>;

    // Log invocation
    if (enableLogging && logger) {
      if (logDetails) {
        logger.log(`IPC: ${channel} called with args:`, JSON.stringify(params));
      } else {
        logger.log(`IPC: ${channel} called`);
      }
    }

    try {
      // Execute handler
      const result = await handler(event, params);

      // Log result
      if (enableLogging && logger) {
        if (logDetails) {
          const resultPreview = JSON.stringify(result)?.slice(0, 100);
          logger.log(`IPC: ${channel} returned: ${resultPreview}...`);
        } else {
          logger.log(`IPC: ${channel} completed successfully`);
        }
      }

      return result;
    } catch (error) {
      // Log error
      if (enableLogging && logger) {
        logger.error(`Error in ${channel}:`, error);
        if (logDetails) {
          logger.error(`Args were:`, JSON.stringify(params));
        }
      }

      // Custom error handler
      if (onError) {
        onError(channel, error, args);
      }

      // Re-throw with channel prefix for better debugging
      throw new Error(`[${channel}] ${error}`);
    }
  });
}

/**
 * Factory function to create a handler registrar with consistent options
 *
 * This is useful when you want to register multiple handlers with the same
 * logging/error handling configuration.
 *
 * @param options - Default options for all handlers created by this factory
 *
 * @example
 * ```typescript
 * const logger = log.scope('app_handlers');
 * const handle = createHandlerFactory({ logger, logDetails: true });
 *
 * handle('create-app', async (event, params) => {
 *   // Automatically logged with the provided logger
 *   return createAppLogic(params);
 * });
 *
 * handle('get-app', async (event, appId) => {
 *   return getAppLogic(appId);
 * });
 * ```
 */
export function createHandlerFactory(options: IpcHandlerOptions = {}) {
  return function handle<T extends IpcChannelName>(
    channel: T,
    handler: IpcHandlerFn<T>,
    handlerSpecificOptions?: IpcHandlerOptions,
  ): void {
    // Merge factory options with handler-specific options
    const mergedOptions = {
      ...options,
      ...handlerSpecificOptions,
    };

    createIpcHandler(channel, handler, mergedOptions);
  };
}

/**
 * Type-safe wrapper for handlers that don't need the event parameter
 *
 * Many handlers don't use the IpcMainInvokeEvent, so this provides a cleaner API
 *
 * @example
 * ```typescript
 * createSimpleHandler('get-app', async (appId) => {
 *   return db.query.apps.findFirst({ where: eq(apps.id, appId) });
 * }, { logger });
 * ```
 */
export function createSimpleHandler<T extends IpcChannelName>(
  channel: T,
  handler: (params: IpcParams<T>) => Promise<IpcReturns<T>> | IpcReturns<T>,
  options: IpcHandlerOptions = {},
): void {
  createIpcHandler(
    channel,
    async (_event, params) => handler(params),
    options,
  );
}
