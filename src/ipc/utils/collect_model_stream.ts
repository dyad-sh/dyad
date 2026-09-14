import type {
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Adapt a streaming-only provider for auxiliary generateText/generateObject calls. */
export async function collectModelStream(
  result: LanguageModelV3StreamResult,
): Promise<LanguageModelV3GenerateResult> {
  const content: LanguageModelV3Content[] = [];
  const blocks = new Map<
    string,
    Extract<LanguageModelV3Content, { type: "text" | "reasoning" }>
  >();
  let finish:
    | Extract<LanguageModelV3StreamPart, { type: "finish" }>
    | undefined;
  let response = result.response;
  let warnings: LanguageModelV3GenerateResult["warnings"] = [];
  const reader = result.stream.getReader();
  try {
    while (true) {
      const { done, value: part } = await reader.read();
      if (done) break;
      switch (part.type) {
        case "text-start":
        case "reasoning-start": {
          const block = {
            type:
              part.type === "text-start"
                ? ("text" as const)
                : ("reasoning" as const),
            text: "",
            providerMetadata: part.providerMetadata,
          };
          blocks.set(`${block.type}:${part.id}`, block);
          content.push(block);
          break;
        }
        case "text-delta":
        case "reasoning-delta":
        case "text-end":
        case "reasoning-end": {
          const type = part.type.startsWith("text-") ? "text" : "reasoning";
          const block = blocks.get(`${type}:${part.id}`);
          if (block) {
            if ("delta" in part) block.text += part.delta;
            if (part.providerMetadata)
              block.providerMetadata = {
                ...block.providerMetadata,
                ...part.providerMetadata,
              };
          }
          break;
        }
        case "tool-call":
        case "tool-result":
        case "tool-approval-request":
        case "file":
        case "source":
          content.push(part);
          break;
        case "stream-start":
          warnings = part.warnings;
          break;
        case "response-metadata": {
          const { type: _type, ...metadata } = part;
          response = { ...response, ...metadata };
          break;
        }
        case "finish":
          finish = part;
          break;
        case "error":
          throw part.error;
      }
    }
    if (!finish)
      throw new DyadError(
        "Model stream ended without a completion result.",
        DyadErrorKind.External,
      );
    return {
      content,
      finishReason: finish.finishReason,
      usage: finish.usage,
      providerMetadata: finish.providerMetadata,
      warnings,
      response,
      request: result.request,
    };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
