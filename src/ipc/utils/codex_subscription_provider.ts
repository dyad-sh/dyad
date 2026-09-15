import type { ExternalModelAdmission } from "../services/external_model_admission";
import { markSubscriptionLimited } from "../services/codex_subscription_account";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
import { collectModelStream } from "./collect_model_stream";
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { getCodexSubscriptionCredentials } from "../services/codex_subscription_auth";
import {
  startSubscriptionUsage,
  finishSubscriptionUsage,
  interruptSubscriptionUsage,
} from "../services/codex_subscription_usage";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { safeGithubOpsErrorMessage } from "../services/github_ops_safe_error";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  excludeSubscriptionReasoning,
  SubscriptionReasoningExclusions,
} from "./subscription_reasoning_exclusions";

const ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const reasoningExclusions = new SubscriptionReasoningExclusions();
const recoveryContext = new AsyncLocalStorage<{ commit?: () => void }>();

async function readSubscriptionErrorDetail(
  response: Response,
  credentials: { access: string; accountId: string },
): Promise<{ detail: string; code?: string }> {
  try {
    // Bound upstream data before parsing or applying diagnostic redaction.
    const reader = response.body?.getReader();
    if (!reader) return { detail: "" };
    const decoder = new TextDecoder();
    let text = "";
    let remaining = 16_384;
    try {
      while (remaining > 0) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value.subarray(0, remaining);
        text += decoder.decode(chunk, { stream: true });
        remaining -= chunk.length;
      }
      text += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
    }
    const payload = JSON.parse(text);
    const error = payload?.error ?? payload;
    const message =
      typeof error === "string" ? error : (error?.message ?? payload?.detail);
    const code = typeof error?.code === "string" ? error.code : "";
    if (typeof message !== "string") return { detail: "", code };
    let detail = code ? `${message} (code: ${code})` : message;
    for (const secret of [credentials.access, credentials.accountId]) {
      if (secret) detail = detail.replaceAll(secret, "[redacted]");
    }
    // Reuse the existing diagnostic redactor for paths, identities, URLs and
    // token syntax. This preserves actionable unknown messages, but cannot
    // guarantee removal of all private content: only use it for error kinds
    // excluded from telemetry, and never attach the raw response as a cause.
    return {
      detail: safeGithubOpsErrorMessage(new Error(detail), "").slice(0, 2_000),
      code,
    };
  } catch {
    return { detail: "" };
  }
}

export function shapeSubscriptionRequest(
  raw: Record<string, unknown>,
): Record<string, unknown> {
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

export async function createCodexSubscriptionModel(
  modelName: string,
  billingKey: string | null,
  context?: { chatId: number; externalModelAdmission?: ExternalModelAdmission },
  fastMode = false,
): Promise<LanguageModelV3> {
  // Fail before any model request; the fetch rechecks expiry for long turns.
  await getCodexSubscriptionCredentials();
  // Calls without a chat get an isolated model-instance scope.
  const chatScope = context?.chatId ?? randomUUID();
  const provider = createOpenAI({
    apiKey: "subscription-auth-managed-in-main",
    baseURL: "https://chatgpt.com/backend-api/codex",
    fetch: async (_url, init) => {
      const credentials = await getCodexSubscriptionCredentials();
      const body = shapeSubscriptionRequest(JSON.parse(String(init?.body)));
      // Set the tier only at the subscription boundary, never on shared OpenAI
      // provider options used by Pro credits or API-key requests.
      if (fastMode) body.service_tier = "priority";
      const scope = createHash("sha256")
        .update(
          JSON.stringify([
            chatScope,
            ENDPOINT,
            credentials.accountId,
            modelName,
          ]),
        )
        .digest("hex");
      body.input = reasoningExclusions.filter(scope, body.input as unknown[]);
      const sendOnce = () => {
        init?.signal?.throwIfAborted();
        return fetch(ENDPOINT, {
          method: "POST",
          redirect: "error",
          signal: init?.signal,
          headers: {
            Authorization: `Bearer ${credentials.access}`,
            "ChatGPT-Account-Id": credentials.accountId,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "OpenAI-Beta": "responses=experimental",
          },
          body: JSON.stringify(body),
        });
      };
      // Retry rejected HTTP requests on this source only. Keep raw OAuth
      // responses out of SDK errors, and never replay a successful stream.
      const send = async () => {
        for (let attempt = 0; ; attempt++) {
          const response = await sendOnce();
          if (response.status < 500 || attempt === 2) return response;
          await response.body?.cancel().catch(() => {});
          await delay(1000 * 2 ** attempt, undefined, {
            signal: init?.signal ?? undefined,
          });
        }
      };
      let response = await send();
      let errorDetail:
        | Awaited<ReturnType<typeof readSubscriptionErrorDetail>>
        | undefined;
      if (response.status === 400) {
        errorDetail = await readSubscriptionErrorDetail(response, credentials);
        if (errorDetail.code === "invalid_encrypted_content") {
          const recovery = excludeSubscriptionReasoning(
            body.input as unknown[],
          );
          if (recovery.hashes.size > 0) {
            body.input = recovery.input;
            // Retry only this rejected HTTP request, never the agent/tool loop.
            response = await send();
            errorDetail = undefined;
            const pending = recoveryContext.getStore();
            if (response.ok && pending) {
              pending.commit = () =>
                reasoningExclusions.remember(scope, recovery.hashes);
            }
          }
        }
      }
      if (response.status === 429) markSubscriptionLimited();
      if (!response.ok) {
        const kind =
          response.status === 429
            ? DyadErrorKind.RateLimited
            : response.status === 401 || response.status === 403
              ? DyadErrorKind.Auth
              : response.status === 400 ||
                  response.status === 404 ||
                  response.status === 422
                ? DyadErrorKind.Validation
                : DyadErrorKind.External;
        const { detail } =
          kind !== DyadErrorKind.External
            ? (errorDetail ??
              (await readSubscriptionErrorDetail(response, credentials)))
            : { detail: "" };
        if (kind === DyadErrorKind.External)
          await response.body?.cancel().catch(() => {});
        // Never let SDK errors retain an OAuth request or raw upstream body.
        const summary =
          response.status === 401 || response.status === 403
            ? "ChatGPT subscription access was rejected. Reconnect or choose an available model."
            : response.status === 429
              ? "ChatGPT subscription limit reached. Wait for your limit to reset, upgrade your ChatGPT subscription tier, or choose another available model."
              : `ChatGPT subscription request failed (HTTP ${response.status}).`;
        throw new DyadError(detail ? `${summary} ${detail}` : summary, kind);
      }
      return response;
    },
  });
  const subscriptionModel: LanguageModelV3 = wrapLanguageModel({
    model: provider.responses(modelName),
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            ...params.providerOptions?.openai,
            store: false,
            include: ["reasoning.encrypted_content"],
          },
        },
      }),
      wrapStream: async ({ doStream, params }) => {
        const id = await startSubscriptionUsage(
          modelName,
          params.abortSignal,
          undefined,
          billingKey,
          context?.externalModelAdmission,
        );
        const recovery: { commit?: () => void } = {};
        let result;
        try {
          result = await recoveryContext.run(recovery, doStream);
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
        let streamFailed = false;
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
                if (chunk.value.type === "error") streamFailed = true;
                if (chunk.value.type === "finish" && !finished) {
                  if (
                    !streamFailed &&
                    !params.abortSignal?.aborted &&
                    ["stop", "tool-calls"].includes(
                      chunk.value.finishReason.unified,
                    )
                  ) {
                    recovery.commit?.();
                  }
                  void finishSubscriptionUsage(
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
      // Reuse the complete streaming path, including credit checks, recovery,
      // usage reporting and cancellation, for non-streaming auxiliary callers.
      wrapGenerate: async ({ params }) =>
        collectModelStream(await subscriptionModel.doStream(params)),
    },
  });
  return subscriptionModel;
}
