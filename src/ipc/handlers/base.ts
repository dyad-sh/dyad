import { ipcMain, IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type { IpcContract } from "../contracts/core";

/**
 * Creates a typed IPC handler from a contract.
 * Provides runtime validation of inputs and type-safe handler implementation.
 *
 * @example
 * createTypedHandler(appContracts.createApp, async (_event, params) => {
 *   // params is typed as z.infer<CreateAppParamsSchema>
 *   // return type is enforced as z.infer<CreateAppResultSchema>
 *   const [app] = await db.insert(apps).values({ name: params.name }).returning();
 *   return { app, chatId: chat.id };
 * });
 */
export function createTypedHandler<
  TChannel extends string,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(
  contract: IpcContract<TChannel, TInput, TOutput>,
  handler: (
    event: IpcMainInvokeEvent,
    input: z.infer<TInput>,
  ) => Promise<z.infer<TOutput>>,
): void {
  ipcMain.handle(
    contract.channel,
    async (event: IpcMainInvokeEvent, rawInput: unknown) => {
      // Runtime validation of input
      const parsed = contract.input.safeParse(rawInput);
      if (!parsed.success) {
        const errorMessage = parsed.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        throw new Error(`[${contract.channel}] Invalid input: ${errorMessage}`);
      }

      const result = await handler(event, parsed.data);

      // Validate output in development mode only (catches handler bugs without prod overhead)
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
    },
  );
}

/**
 * Creates a typed IPC handler with logging support.
 * Combines typed handling with the existing logging infrastructure.
 *
 * @example
 * const handle = createLoggedTypedHandler(logger);
 * handle(appContracts.createApp, async (_event, params) => {
 *   return { app, chatId: chat.id };
 * });
 */
export function createLoggedTypedHandler(logger: {
  info: (msg: string) => void;
  error: (msg: string, err?: any) => void;
}) {
  return function <
    TChannel extends string,
    TInput extends z.ZodType,
    TOutput extends z.ZodType,
  >(
    contract: IpcContract<TChannel, TInput, TOutput>,
    handler: (
      event: IpcMainInvokeEvent,
      input: z.infer<TInput>,
    ) => Promise<z.infer<TOutput>>,
  ): void {
    ipcMain.handle(
      contract.channel,
      async (event: IpcMainInvokeEvent, rawInput: unknown) => {
        // Runtime validation of input
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
          const result = await handler(event, parsed.data);

          // Validate output in development mode only
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
          throw err;
        }
      },
    );
  };
}

/**
 * Helper to register multiple typed handlers at once.
 *
 * @example
 * registerTypedHandlers({
 *   [appContracts.createApp]: async (_event, params) => { ... },
 *   [appContracts.deleteApp]: async (_event, params) => { ... },
 * });
 */
export function registerTypedHandlers<
  T extends Record<string, IpcContract<string, z.ZodType, z.ZodType>>,
>(
  handlers: {
    [K in keyof T]: (
      event: IpcMainInvokeEvent,
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
