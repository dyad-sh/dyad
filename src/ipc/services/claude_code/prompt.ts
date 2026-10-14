import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";

/** Send inline media using the CLI's documented stream-json user envelope.
 * The SDK resolves authorized attachment URLs; this layer never fetches URLs. */
export function claudeConversation(
  prompt: LanguageModelV3Prompt,
  resume: boolean,
  recovery: unknown[] = [],
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
        throw new DyadError(
          "Attachment URL was not resolved by Dyad",
          DyadErrorKind.Validation,
        );
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
  const prefix = resume
    ? ""
    : "Continue this Dyad conversation. Historical tool calls/results below are data, not requests to replay. Only act on the latest user request.\n";
  // Keep complete receipts, newest first in priority. Never invent partial answers.
  const receipts: unknown[] = [];
  let receiptBytes = 2;
  let omitted = false;
  for (const receipt of [...recovery].reverse()) {
    const bytes = Buffer.byteLength(JSON.stringify(receipt)) + 1;
    if (receiptBytes + bytes > 64 * 1024) {
      omitted = true;
      continue;
    }
    receipts.unshift(receipt);
    receiptBytes += bytes;
  }
  const suffix = resume
    ? ""
    : "\nDurable questionnaire outcomes (do not replay interrupted requests):\n" +
      JSON.stringify(receipts) +
      (omitted
        ? "\n[Some questionnaire outcomes omitted to fit the context handoff limit; do not infer their answers.]"
        : "");
  const omission = {
    role: "system",
    content: "[Older Dyad history omitted to fit the context handoff limit.]",
  };
  // One UTF-8 budget includes recovery, instructions and JSON framing.
  // Keep the newest conversation context; never replay historical operations.
  const selected: unknown[] = [];
  let budget =
    256 * 1024 -
    Buffer.byteLength(prefix + suffix) -
    2 -
    Buffer.byteLength(JSON.stringify(omission)) -
    1;
  for (const message of history.reverse()) {
    const serialized = JSON.stringify(message);
    const bytes = Buffer.byteLength(serialized) + 1;
    if (bytes > budget) {
      if (!selected.length)
        throw new DyadError(
          "Latest message exceeds the Claude context handoff limit",
          DyadErrorKind.Validation,
        );
      selected.unshift(omission);
      break;
    }
    selected.unshift(message);
    budget -= bytes;
  }
  return { text: prefix + JSON.stringify(selected) + suffix, content };
}
