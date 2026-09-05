/**
 * Prompt assembly for Claude Code turns.
 *
 * Claude Code brings its own system prompt; Dyad appends a short section
 * describing the Dyad workspace, the tool restrictions, and the bridge tools,
 * plus the app's AI_RULES.md. The user message carries the already-assembled
 * Dyad prompt (mentions, selected components, attachment references).
 */
import fs from "node:fs";
import path from "node:path";
import type {
  ChatBackendAttachment,
  ChatBackendTurnMode,
} from "@/chat_backend/backend";
import type { CliUserContentBlock } from "./stream_json_protocol";
import { CLAUDE_CODE_MCP_TOOL_PREFIX } from "./permission_policy";

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function buildClaudeCodeSystemPromptAppendix({
  mode,
  appInstructions,
  bridgeToolNames,
  appPath,
}: {
  mode: ChatBackendTurnMode;
  appInstructions: string | null;
  bridgeToolNames: string[];
  appPath: string;
}): string {
  const sections: string[] = [];
  sections.push(
    [
      "# Dyad workspace",
      "",
      `You are running inside Dyad, a local AI app builder. The working directory (${appPath}) is the user's app. Dyad shows your text and file edits in its chat, refreshes the live preview after your turn, and creates a version checkpoint from the files you change.`,
      "",
      "## Tool restrictions",
      "",
      "- Shell/command tools (Bash and similar) are not available in this session and cannot be enabled. Do not ask the user to enable them.",
      mode === "agent"
        ? "- You can read, search, and edit files inside the app directory only."
        : mode === "ask"
          ? "- This is Ask mode: you can read and search files but must not modify anything. Answer questions and explain code instead of editing."
          : "- This is Plan mode: you can read and search files but must not modify anything. Produce a clear implementation plan for the user to approve.",
      "- Environment secret files (.env*) cannot be read.",
    ].join("\n"),
  );

  if (bridgeToolNames.length > 0) {
    const toolLines = bridgeToolNames.map(
      (name) => `- \`${CLAUDE_CODE_MCP_TOOL_PREFIX}${name}\``,
    );
    sections.push(
      [
        "## Dyad operations",
        "",
        "Use these Dyad-provided tools instead of shell commands:",
        ...toolLines,
        "",
        "Dependency installs, type checks, tests, and preview restarts must go through these tools; they run with Dyad's validation and the user's permission settings.",
      ].join("\n"),
    );
  }

  sections.push(
    [
      "## Response style",
      "",
      "- Keep explanations concise; the user sees each file edit as a card in Dyad's chat.",
      "- Do not narrate tool restrictions unless the user asks about them.",
    ].join("\n"),
  );

  if (appInstructions && appInstructions.trim()) {
    sections.push(
      ["# App instructions (AI_RULES.md)", "", appInstructions.trim()].join(
        "\n",
      ),
    );
  }
  return sections.join("\n\n");
}

export function buildClaudeCodeUserMessage({
  prompt,
  attachments,
}: {
  prompt: string;
  attachments: ChatBackendAttachment[];
}): string | CliUserContentBlock[] {
  if (attachments.length === 0) {
    return prompt;
  }
  const blocks: CliUserContentBlock[] = [];
  const lines: string[] = [prompt.trimEnd(), "", "Attachments:"];
  for (const attachment of attachments) {
    const relative = path.relative(process.cwd(), attachment.filePath);
    const location = attachment.filePath;
    if (attachment.attachmentType === "upload-to-codebase") {
      lines.push(
        `- "${attachment.originalName}" (${attachment.mimeType}) stored at ${location}. Copy it into the codebase at an appropriate location by reading it and writing it with the Write tool.`,
      );
    } else {
      lines.push(
        `- "${attachment.originalName}" (${attachment.mimeType}) stored at ${location}. Read it if the content is relevant.`,
      );
    }
    void relative;
    if (INLINE_IMAGE_TYPES.has(attachment.mimeType)) {
      try {
        const stat = fs.statSync(attachment.filePath);
        if (stat.size <= MAX_INLINE_IMAGE_BYTES) {
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: attachment.mimeType,
              data: fs.readFileSync(attachment.filePath).toString("base64"),
            },
          });
        }
      } catch {
        // The path reference above still lets the model read it on demand.
      }
    }
  }
  return [{ type: "text", text: lines.join("\n") }, ...blocks];
}
