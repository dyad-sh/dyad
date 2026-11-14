import path from "node:path";
import { escapeXmlContent } from "../../../../../shared/xmlEscape";
import type { ClaudeToolCard } from "@/shared/claude_tool_cards";
import type { CliEvent } from "../runtime";
import { NATIVE_SUBAGENT_TOOLS } from "./tool_policy";

/** Cards persist in message content, so bound everything they carry. */
const MAX_BODY_CHARS = 16_000;
const MAX_SUBJECT_CHARS = 2_000;
const MAX_BLOCK_CHARS = 8_000;
const MAX_STEPS = 50;

/** Plumbing the user does not need to see. */
const HIDDEN_TOOLS = new Set(["ToolSearch"]);

type CardState = ClaudeToolCard["state"];

interface PendingTool {
  name: string;
  input: Record<string, unknown>;
  steps: string[];
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n… [truncated]`;
}

/** Keep the end of command output, where results and errors usually are. */
function tail(value: string, max: number): string {
  return value.length <= max
    ? value
    : `[truncated]…\n${value.slice(value.length - max)}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && part.type === "text"
        ? text(part.text)
        : part && typeof part === "object" && part.type === "image"
          ? "[image]"
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

export function nativeCardXml(card: ClaudeToolCard): string {
  return `<dyad-claude-tool>${escapeXmlContent(JSON.stringify(card))}</dyad-claude-tool>`;
}

/** One line describing a tool call, used for subagent step lists. */
function describeStep(
  name: string,
  input: Record<string, unknown>,
  display: (p: string) => string,
): string {
  const file = text(input.file_path) || text(input.notebook_path);
  if (file) return `${name} ${display(file)}`;
  const subject =
    text(input.command) ||
    text(input.pattern) ||
    text(input.query) ||
    text(input.url) ||
    text(input.description);
  return clip(subject ? `${name}: ${subject}` : name, 200);
}

/**
 * Projects Claude Code's tool events into Dyad tool cards.
 *
 * Dyad MCP tools render their own cards when Dyad executes them, so they are
 * skipped here. Subagent (Task) internals are folded into the subagent's
 * card as a step list instead of flooding the chat.
 */
export function createNativeEventProjector({
  appPath,
  preview,
  commit,
}: {
  appPath: string;
  /** Show (or with "" clear) a live card for a running tool. */
  preview(xml: string): void;
  /** Append a finished card to the response, in stream order. */
  commit(xml: string): void;
}) {
  const pending = new Map<string, PendingTool>();
  let previewId: string | undefined;
  const root = path.resolve(appPath);

  const display = (filePath: string) => {
    const resolved = path.resolve(root, filePath);
    const relative = path.relative(root, resolved);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative.split(path.sep).join("/")
      : filePath;
  };

  const card = (
    tool: PendingTool,
    state: CardState,
    result: string,
  ): ClaudeToolCard | undefined => {
    const { name, input } = tool;
    const base = { state, tool: name, body: "" } as const;
    if (name.startsWith("mcp__")) {
      const [, server = "", ...rest] = name.split("__");
      return {
        ...base,
        kind: "tool",
        title: `${server} / ${rest.join("__")}`,
        subject: clip(JSON.stringify(input), MAX_SUBJECT_CHARS),
        body: clip(result, MAX_BODY_CHARS),
      };
    }
    switch (name) {
      case "Read":
        return {
          ...base,
          kind: "read",
          path: display(text(input.file_path)),
          ...(typeof input.offset === "number"
            ? { startLine: String(input.offset) }
            : {}),
          ...(typeof input.offset === "number" &&
          typeof input.limit === "number"
            ? { endLine: String(input.offset + input.limit) }
            : {}),
          ...(state === "error"
            ? { summary: clip(result, MAX_SUBJECT_CHARS) }
            : {}),
        };
      case "Write":
        return {
          ...base,
          kind: "write",
          path: display(text(input.file_path)),
          body: clip(text(input.content), MAX_BODY_CHARS),
          ...(state === "error"
            ? { summary: clip(result, MAX_SUBJECT_CHARS) }
            : {}),
        };
      case "Edit":
      case "MultiEdit":
      case "NotebookEdit": {
        const edits = Array.isArray(input.edits)
          ? (input.edits as Record<string, unknown>[])
          : [input];
        return {
          ...base,
          kind: "edit",
          path: display(text(input.file_path) || text(input.notebook_path)),
          blocks: edits.slice(0, 20).map((edit) => ({
            searchContent: clip(text(edit.old_string), MAX_BLOCK_CHARS),
            replaceContent: clip(
              text(edit.new_string) || text(edit.new_source),
              MAX_BLOCK_CHARS,
            ),
          })),
          ...(state === "error"
            ? { summary: clip(result, MAX_SUBJECT_CHARS) }
            : {}),
        };
      }
      case "Glob":
      case "LS":
        return {
          ...base,
          kind: "list",
          path: text(input.pattern) || display(text(input.path) || "."),
          body: clip(result, MAX_BODY_CHARS),
        };
      case "Grep":
        return {
          ...base,
          kind: "search",
          subject: clip(text(input.pattern), MAX_SUBJECT_CHARS),
          ...(text(input.path) ? { path: display(text(input.path)) } : {}),
          body: clip(result, MAX_BODY_CHARS),
        };
      case "Bash":
      case "PowerShell":
        return {
          ...base,
          kind: "shell",
          subject: clip(text(input.command), MAX_SUBJECT_CHARS),
          ...(text(input.description)
            ? { summary: clip(text(input.description), 500) }
            : {}),
          body: tail(result, MAX_BODY_CHARS),
        };
      case "WebSearch":
      case "WebFetch":
        return {
          ...base,
          kind: "web",
          subject: clip(
            text(input.query) || text(input.url),
            MAX_SUBJECT_CHARS,
          ),
          body: clip(result, MAX_BODY_CHARS),
        };
      case "Task":
      case "Agent":
        return {
          ...base,
          kind: "task",
          subject: clip(
            text(input.description) || text(input.prompt),
            MAX_SUBJECT_CHARS,
          ),
          ...(text(input.subagent_type)
            ? { summary: text(input.subagent_type) }
            : {}),
          steps: tool.steps.slice(-MAX_STEPS),
          body: clip(result, MAX_BODY_CHARS),
        };
      default:
        return {
          ...base,
          kind: "tool",
          title: name,
          subject: clip(
            text(input.skill) ||
              text(input.command) ||
              JSON.stringify(input) ||
              "",
            MAX_SUBJECT_CHARS,
          ),
          body: clip(result, MAX_BODY_CHARS),
        };
    }
  };

  const showPreview = (id: string, tool: PendingTool) => {
    const value = card(tool, "pending", "");
    if (!value) return;
    previewId = id;
    preview(nativeCardXml(value));
  };

  const finish = (id: string, state: CardState, result: string) => {
    const tool = pending.get(id);
    if (!tool) return;
    pending.delete(id);
    if (previewId === id) {
      previewId = undefined;
      preview("");
    }
    const value = card(tool, state, result);
    if (value) commit(nativeCardXml(value));
  };

  return {
    onEvent(event: CliEvent) {
      const parent =
        typeof event.parent_tool_use_id === "string"
          ? event.parent_tool_use_id
          : undefined;
      const blocks: unknown[] = Array.isArray(event.message?.content)
        ? event.message.content
        : [];
      if (event.type === "assistant") {
        for (const block of blocks) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, any>;
          if (b.type !== "tool_use" || typeof b.id !== "string") continue;
          const name = text(b.name);
          const input =
            b.input && typeof b.input === "object" ? b.input : ({} as never);
          if (parent) {
            // A subagent's own tool call: fold it into the subagent's card.
            const owner = pending.get(parent);
            if (owner && !name.startsWith("mcp__dyad__")) {
              owner.steps.push(describeStep(name, input, display));
              if (previewId === parent) showPreview(parent, owner);
            }
            continue;
          }
          if (name.startsWith("mcp__dyad__") || HIDDEN_TOOLS.has(name))
            continue;
          const tool = { name, input, steps: [] };
          pending.set(b.id, tool);
          showPreview(b.id, tool);
        }
        return;
      }
      if (event.type === "user" && !parent) {
        for (const block of blocks) {
          if (!block || typeof block !== "object") continue;
          const b = block as Record<string, any>;
          if (b.type !== "tool_result" || typeof b.tool_use_id !== "string")
            continue;
          finish(
            b.tool_use_id,
            b.is_error ? "error" : "finished",
            resultText(b.content),
          );
        }
        return;
      }
      if (event.type === "system" && event.subtype === "compact_boundary") {
        commit(
          nativeCardXml({
            kind: "status",
            state: "finished",
            tool: "compact_boundary",
            body: "",
          }),
        );
      }
    },
    /** Close out tools that never reported a result (stop, crash, limit). */
    flush() {
      for (const id of pending.keys()) finish(id, "aborted", "");
    },
    /** Subagent tool-use ids that are still running. */
    hasRunningSubagents() {
      return [...pending.values()].some((tool) =>
        NATIVE_SUBAGENT_TOOLS.has(tool.name),
      );
    },
  };
}
