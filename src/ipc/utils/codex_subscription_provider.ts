import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3Message,
} from "@ai-sdk/provider";
import { getCodexSubscriptionCredentials } from "../services/codex_subscription_auth";
import {
  startSubscriptionUsage,
  finishSubscriptionUsage,
  interruptSubscriptionUsage,
} from "../services/codex_subscription_usage";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

/** Portable history only: no account-bound encrypted reasoning or server IDs.
 * Keep visible text and paired function calls/results. Opaque reasoning is not
 * a portable conversation transcript and must never cross authentication lanes.
 */
export function portableModelParams(
  params: LanguageModelV3CallOptions,
): LanguageModelV3CallOptions {
  return {
    ...params,
    prompt: params.prompt.flatMap<LanguageModelV3Message>((message) => {
      if (message.role === "system")
        return [{ ...message, providerOptions: undefined }];
      const content = message.content
        .filter((part) => part.type !== "reasoning")
        .map((part) => ({ ...part, providerOptions: undefined }));
      return content.length
        ? [
            {
              ...message,
              providerOptions: undefined,
              content,
            } as typeof message,
          ]
        : [];
    }),
  };
}

export function shapeSubscriptionRequest(raw: Record<string, unknown>) {
  const body = { ...raw, store: false, stream: true };
  for (const key of [
    "max_output_tokens",
    "temperature",
    "top_p",
    "metadata",
    "previous_response_id",
    "conversation",
    "truncation",
    "context_management",
  ])
    delete (body as Record<string, unknown>)[key];
  const input = Array.isArray(raw.input) ? raw.input : [];
  const instructions: string[] =
    typeof raw.instructions === "string" ? [raw.instructions] : [];
  (body as Record<string, unknown>).input = input.filter((item) => {
    if (item.role !== "system" && item.role !== "developer") return true;
    if (typeof item.content === "string") instructions.push(item.content);
    else if (Array.isArray(item.content))
      instructions.push(
        ...item.content
          .filter((p: { text?: string }) => typeof p.text === "string")
          .map((p: { text: string }) => p.text),
      );
    return false;
  });
  (body as Record<string, unknown>).instructions =
    instructions.join("\n\n") || "You are a helpful coding assistant.";
  return body;
}

export function withPortableHistory(model: LanguageModelV3): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => portableModelParams(params),
    },
  });
}

export async function createCodexSubscriptionModel(
  modelName: string,
): Promise<LanguageModelV3> {
  // Fail before any model request; the fetch rechecks expiry for long turns.
  await getCodexSubscriptionCredentials();
  const provider = createOpenAI({
    apiKey: "subscription-auth-managed-in-main",
    baseURL: "https://chatgpt.com/backend-api/codex",
    fetch: async (_url, init) => {
      const credentials = await getCodexSubscriptionCredentials();
      const body = shapeSubscriptionRequest(JSON.parse(String(init?.body)));
      const response = await fetch(ENDPOINT, {
        method: "POST",
        redirect: "error",
        signal: init?.signal,
        headers: {
          Authorization: `Bearer ${credentials.access}`,
          "ChatGPT-Account-Id": credentials.accountId,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          originator: "dyad",
          "OpenAI-Beta": "responses=experimental",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        await response.body?.cancel();
        // Never let SDK errors retain an OAuth request or upstream error body.
        throw new DyadError(
          response.status === 401 || response.status === 403
            ? "ChatGPT subscription access was rejected. Reconnect or choose an available model."
            : response.status === 429
              ? "ChatGPT subscription limit reached. Wait or explicitly choose another connection."
              : `ChatGPT subscription request failed (HTTP ${response.status}).`,
          response.status === 429
            ? DyadErrorKind.RateLimited
            : response.status === 401 || response.status === 403
              ? DyadErrorKind.Auth
              : response.status === 400 ||
                  response.status === 404 ||
                  response.status === 422
                ? DyadErrorKind.Validation
                : DyadErrorKind.External,
        );
      }
      return response;
    },
  });
  return wrapLanguageModel({
    model: provider.responses(modelName),
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => ({
        ...portableModelParams(params),
        providerOptions: {
          ...params.providerOptions,
          openai: { ...params.providerOptions?.openai, store: false },
        },
      }),
      wrapStream: async ({ doStream }) => {
        const id = await startSubscriptionUsage(modelName);
        let result;
        try {
          result = await doStream();
        } catch (error) {
          interruptSubscriptionUsage(
            id,
            error instanceof DyadError &&
              [
                DyadErrorKind.Auth,
                DyadErrorKind.RateLimited,
                DyadErrorKind.Validation,
              ].includes(error.kind),
          );
          throw error;
        }
        let actualModel = modelName;
        let finished = false;
        const reader = result.stream.getReader();
        return {
          ...result,
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            async pull(controller) {
              try {
                const chunk = await reader.read();
                if (chunk.done) {
                  if (!finished) interruptSubscriptionUsage(id);
                  controller.close();
                  return;
                }
                if (
                  chunk.value.type === "response-metadata" &&
                  chunk.value.modelId
                )
                  actualModel = chunk.value.modelId;
                if (chunk.value.type === "finish" && !finished) {
                  await finishSubscriptionUsage(
                    id,
                    actualModel,
                    chunk.value.usage,
                  );
                  finished = true;
                }
                controller.enqueue(chunk.value);
              } catch (error) {
                if (!finished) interruptSubscriptionUsage(id);
                controller.error(error);
              }
            },
            async cancel(reason) {
              if (!finished) interruptSubscriptionUsage(id);
              await reader.cancel(reason);
            },
          }),
        };
      },
      wrapGenerate: async () => {
        throw new DyadError(
          "Subscription requests require streaming. Use the chat workflow.",
          DyadErrorKind.Precondition,
        );
      },
    },
  });
}
