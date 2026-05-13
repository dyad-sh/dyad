import { z } from "zod";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { IpcContract } from "../contracts/core";
import { sendTelemetryException } from "../utils/telemetry";

// ---------------------------------------------------------------------------
// Dual-mode support: Electron IPC (default) or Express HTTP (web mode)
// ---------------------------------------------------------------------------

type WebHandler = (input: unknown) => Promise<unknown>;

/** Registry used in web mode instead of ipcMain */
export const webHandlerRegistry = new Map<string, WebHandler>();

/** Call this before importing any handlers to enable web/Express mode */
let _webMode = false;
export function enableWebMode(): void {
  _webMode = true;
}
export function isWebMode(): boolean {
  return _webMode;
}

// Lazily load Electron ipcMain only when available
function getIpcMain(): typeof import("electron").ipcMain | undefined {
  try {
    if (process.versions?.electron) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("electron").ipcMain;
    }
  } catch {
    // Not in Electron
  }
  return undefined;
}

type AnyEvent = Record<string, unknown>;

/**
 * Creates a typed IPC handler from a contract.
 * In Electron mode: registers via ipcMain.handle().
 * In web mode: registers into webHandlerRegistry (consumed by Express server).
 */
export function createTypedHandler<
  TChannel extends string,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(
  contract: IpcContract<TChannel, TInput, TOutput>,
  handler: (
    event: AnyEvent,
    input: z.infer<TInput>,
  ) => Promise<z.infer<TOutput>>,
): void {
  const wrappedHandler = async (rawInput: unknown): Promise<z.infer<TOutput>> => {
    const parsed = contract.input.safeParse(rawInput);
    if (!parsed.success) {
      const errorMessage = parsed.error.issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      throw new Error(`[${contract.channel}] Invalid input: ${errorMessage}`);
    }

    let result: z.infer<TOutput>;
    try {
      result = await handler({}, parsed.data);
    } catch (err) {
      sendTelemetryException(err, { ipc_channel: contract.channel });
      throw err;
    }

    if (process.env.NODE_ENV === "development") {
      const outputParsed = contract.output.safeParse(result);
      if (!outputParsed.success) {
        const errorMessage = outputParsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        throw new DyadError(
          `[${contract.channel}] Invalid input: ${errorMessage}`,
          DyadErrorKind.Validation,
        );
      }
    }

    return result;
  };

  if (_webMode) {
    webHandlerRegistry.set(contract.channel, wrappedHandler);
    return;
  }

  const ipcMain = getIpcMain();
  if (!ipcMain) {
    console.warn(
      `[${contract.channel}] Neither web mode nor Electron ipcMain available — handler not registered.`,
    );
    return;
  }

  ipcMain.handle(
    contract.channel,
    async (_event: AnyEvent, rawInput: unknown) => {
      return wrappedHandler(rawInput);
    },
  );
}

/**
 * Creates a typed IPC handler with logging support.
 */
export function createLoggedTypedHandler(logger: {
  info: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
}) {
  return function <
    TChannel extends string,
    TInput extends z.ZodType,
    TOutput extends z.ZodType,
  >(
    contract: IpcContract<TChannel, TInput, TOutput>,
    handler: (
      event: AnyEvent,
      input: z.infer<TInput>,
    ) => Promise<z.infer<TOutput>>,
  ): void {
    const wrappedHandler = async (
      rawInput: unknown,
    ): Promise<z.infer<TOutput>> => {
      const parsed = contract.input.safeParse(rawInput);
      if (!parsed.success) {
        const errorMessage = parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        const error = new Error(
          `[${contract.channel}] Invalid input: ${errorMessage}`,
        );
        logger.error(`[${contract.channel}] Invalid input`, error);
        throw error;
      }

      try {
        logger.info(`[${contract.channel}] Handling request`);
        const result = await handler({}, parsed.data);

        if (process.env.NODE_ENV === "development") {
          const outputParsed = contract.output.safeParse(result);
          if (!outputParsed.success) {
            const errorMessage = outputParsed.error.issues
              .map((e) => `${e.path.join(".")}: ${e.message}`)
              .join("; ");
            console.error(
              `[${contract.channel}] Output validation warning: ${errorMessage}`,
            );
          }
        }

        return result;
      } catch (err) {
        logger.error(`[${contract.channel}] Handler error`, err);
        sendTelemetryException(err, { ipc_channel: contract.channel });
        throw err;
      }
    };

    if (_webMode) {
      webHandlerRegistry.set(contract.channel, wrappedHandler);
      return;
    }

    const ipcMain = getIpcMain();
    if (!ipcMain) {
      console.warn(
        `[${contract.channel}] Neither web mode nor Electron ipcMain available — handler not registered.`,
      );
      return;
    }

    ipcMain.handle(
      contract.channel,
      async (_event: AnyEvent, rawInput: unknown) => {
        return wrappedHandler(rawInput);
      },
    );
  };
}

/**
 * Helper to register multiple typed handlers at once.
 */
export function registerTypedHandlers<
  T extends Record<string, IpcContract<string, z.ZodType, z.ZodType>>,
>(
  handlers: {
    [K in keyof T]: (
      event: AnyEvent,
      input: z.infer<T[K]["input"]>,
    ) => Promise<z.infer<T[K]["output"]>>;
  },
  contracts: T,
): void {
  for (const [key, contract] of Object.entries(contracts)) {
    const handler = handlers[key as keyof typeof handlers];
    if (handler) {
      // @ts-expect-error zod v4 type inference is not working correctly
      createTypedHandler(contract, handler);
    }
  }
}
