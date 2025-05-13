import { streamText } from "ai";
import log from "electron-log";
import { ModelClient } from "./get_model_client";
import { llmErrorStore } from "@/main/llm_error_store";
const logger = log.scope("stream_utils");

export interface StreamTextWithBackupParams
  extends Omit<Parameters<typeof streamText>[0], "model"> {
  model: ModelClient; // primary client
  backupModelClients?: ModelClient[]; // ordered fall-backs
}

export function streamTextWithBackup(params: StreamTextWithBackupParams): {
  textStream: AsyncIterable<string>;
} {
  const {
    model: primaryModel,
    backupModelClients = [],
    onError: callerOnError,
    abortSignal: callerAbort,
    ...rest
  } = params;

  const modelClients: ModelClient[] = [primaryModel, ...backupModelClients];

  async function* combinedGenerator(): AsyncIterable<string> {
    let lastErr: { error: unknown } | undefined = undefined;

    for (let i = 0; i < modelClients.length; i++) {
      const currentModelClient = modelClients[i];

      /* Local abort controller for this single attempt  */
      const attemptAbort = new AbortController();
      if (callerAbort) {
        if (callerAbort.aborted) {
          // Already aborted, trigger immediately
          attemptAbort.abort();
        } else {
          callerAbort.addEventListener("abort", () => attemptAbort.abort(), {
            once: true,
          });
        }
      }

      let errorFromCurrent: { error: unknown } | undefined = undefined; // set when onError fires
      const providerId = currentModelClient.builtinProviderId;
      if (providerId) {
        llmErrorStore.clearModelError({
          model: currentModelClient.model.modelId,
          provider: providerId,
        });
      }
      logger.info(
        "Streaming text with model",
        currentModelClient.model.modelId,
        "provider",
        currentModelClient.model.provider,
        "builtinProviderId",
        currentModelClient.builtinProviderId,
      );
      const { textStream } = streamText({
        ...rest,
        maxRetries: 0,
        model: currentModelClient.model,
        abortSignal: attemptAbort.signal,
        onError: (error) => {
          const providerId = currentModelClient.builtinProviderId;
          if (providerId) {
            llmErrorStore.recordModelError({
              model: currentModelClient.model.modelId,
              provider: providerId,
            });
          }
          logger.error(
            `Error streaming text with ${providerId} and model ${currentModelClient.model.modelId}: ${error}`,
            error,
          );
          errorFromCurrent = error;
          attemptAbort.abort(); // kill fetch / SSE
        },
      });

      try {
        for await (const chunk of textStream) {
          /* If onError fired during streaming, bail out immediately. */
          if (errorFromCurrent) throw errorFromCurrent;
          yield chunk;
        }

        /* Stream ended – check if it actually failed */
        if (errorFromCurrent) throw errorFromCurrent;

        /* Completed successfully – stop trying more models. */
        return;
      } catch (err) {
        if (typeof err === "object" && err !== null && "error" in err) {
          lastErr = err as { error: unknown };
        } else {
          lastErr = { error: err };
        }
        logger.warn(
          `[streamTextWithBackup] model #${i} failed – ${
            i < modelClients.length - 1
              ? "switching to backup"
              : "no backups left"
          }`,
          err,
        );
        /* loop continues to next model (if any) */
      }
    }

    /* Every model failed */
    if (!lastErr) {
      throw new Error("Invariant in StreamTextWithbackup failed!");
    }
    callerOnError?.(lastErr);
    logger.error("All model invocations failed", lastErr);
    // throw lastErr ?? new Error("All model invocations failed");
  }

  return { textStream: combinedGenerator() };
}
