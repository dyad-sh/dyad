import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";

/** Send inline media using the CLI's documented stream-json user envelope.
 * The SDK resolves authorized attachment URLs; this layer never fetches URLs. */
export function claudeConversation(
  prompt: LanguageModelV3Prompt,
  resume: boolean,
) {
  const conversation = prompt.filter((message) => message.role !== "system");
  const latest = [...conversation]
    .reverse()
    .find((message) => message.role === "user");
  const content: Array<Record<string, unknown>> = [];
  if (latest?.role === "user") {
    for (const part of latest.content) {
      if (part.type !== "file") continue;
      if (part.data instanceof URL)
        throw new Error("Attachment URL was not resolved by Dyad");
      const data =
        typeof part.data === "string"
          ? part.data
          : Buffer.from(part.data).toString("base64");
      if (data.length > 8 * 1024 * 1024)
        throw new DyadError(
          "Claude attachment exceeds the 8 MiB limit",
          DyadErrorKind.Validation,
        );
      if (
        part.mediaType.startsWith("image/") ||
        part.mediaType === "application/pdf"
      ) {
        content.push({
          type: part.mediaType.startsWith("image/") ? "image" : "document",
          source: { type: "base64", media_type: part.mediaType, data },
        });
      } else if (part.mediaType.startsWith("text/")) {
        content.push({
          type: "text",
          text: `Attachment ${part.filename ?? ""}:\n${Buffer.from(data, "base64").toString("utf8")}`,
        });
      } else
        throw new DyadError(
          `Unsupported Claude input attachment type: ${part.mediaType}`,
          DyadErrorKind.Validation,
        );
    }
  }
  const history = (resume ? conversation.slice(-1) : conversation).map(
    (message) => ({
      ...message,
      content: message.content.map((part) =>
        part.type === "file"
          ? {
              type: "text",
              text: `[Attachment: ${part.filename ?? part.mediaType}]`,
            }
          : part,
      ),
    }),
  );
  // Keep the newest conversation context; never replay historical operations.
  const selected: unknown[] = [];
  let budget = 256 * 1024;
  for (const message of history.reverse()) {
    const serialized = JSON.stringify(message);
    if (serialized.length > budget) {
      if (!selected.length)
        throw new DyadError(
          "Latest message exceeds the Claude context handoff limit",
          DyadErrorKind.Validation,
        );
      selected.unshift({
        role: "system",
        content:
          "[Older Dyad history omitted to fit the context handoff limit.]",
      });
      break;
    }
    selected.unshift(message);
    budget -= serialized.length;
  }
  return { text: JSON.stringify(selected), content };
}
