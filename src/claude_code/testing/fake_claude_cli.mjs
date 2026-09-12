#!/usr/bin/env node
/**
 * Deterministic stand-in for the Claude Code CLI used by Dyad's tests.
 *
 * Speaks the same stream-json stdin/stdout protocol Dyad drives in
 * production (verified against Claude Code 2.1.260): init, partial text
 * deltas, assistant/user tool events, `can_use_tool` and `mcp_message`
 * control requests, interrupt handling, and a final `result` event with the
 * per-model usage shape the real CLI prints.
 *
 * Scenario selection: `[scenario:<name>]` in the user prompt, else the
 * FAKE_CLAUDE_SCENARIO env var, else `write-file`. Every invocation appends a
 * JSON line describing its argv/cwd/env to FAKE_CLAUDE_LOG when set.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { randomUUID } from "node:crypto";

if (process.argv.includes("--version")) {
  process.stdout.write(
    `${process.env.FAKE_CLAUDE_VERSION ?? "2.1.260"} (Claude Code)\n`,
  );
  process.exit(0);
}
if (process.argv[2] === "auth" && process.argv[3] === "status") {
  const loggedIn = process.env.FAKE_CLAUDE_LOGGED_IN !== "0";
  process.stdout.write(
    `${JSON.stringify({
      loggedIn,
      authMethod: loggedIn ? "claude.ai" : undefined,
      subscriptionType: loggedIn ? "max" : undefined,
      email: loggedIn ? "user@example.com" : undefined,
    })}\n`,
  );
  process.exit(0);
}

const argv = process.argv.slice(2);
function flag(name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : (argv[index + 1] ?? null);
}
const resumeSessionId = flag("--resume");
const requestedSessionId = flag("--session-id");
const sessionId = resumeSessionId ?? requestedSessionId ?? randomUUID();
const tools = (flag("--tools") ?? "").split(",").filter(Boolean);
const model = flag("--model") ?? "sonnet";
const resolvedModel =
  model === "opus"
    ? "claude-opus-4-8"
    : model === "sonnet"
      ? "claude-sonnet-5"
      : model;
const systemPromptFile = flag("--append-system-prompt-file");
const systemPromptAppendix = systemPromptFile
  ? fs.readFileSync(systemPromptFile, "utf8")
  : "";

function logInvocation(extra = {}) {
  if (!process.env.FAKE_CLAUDE_LOG) return;
  fs.appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    `${JSON.stringify({
      argv,
      cwd: process.cwd(),
      hasAnthropicApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
      systemPromptAppendix,
      ...extra,
    })}\n`,
  );
}

const out = (obj) => {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
};

const pending = new Map();
let userMessage = null;
let interrupted = false;
let stdinClosed = false;
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.type === "user" && !userMessage) {
    userMessage = message.message;
    void run();
    return;
  }
  if (message.type === "control_response") {
    const waiter = pending.get(message.response.request_id);
    if (waiter) {
      pending.delete(message.response.request_id);
      waiter(message.response);
    }
    return;
  }
  if (
    message.type === "control_request" &&
    message.request?.subtype === "interrupt"
  ) {
    interrupted = true;
    logInvocation({ interrupted: true });
    out({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: message.request_id,
        response: { still_queued: [] },
      },
    });
  }
});
rl.on("close", () => {
  stdinClosed = true;
  if (finished) process.exit(0);
});
process.on("SIGTERM", () => {
  logInvocation({ sigterm: true });
  process.exit(143);
});

function request(payload) {
  const id = randomUUID();
  return new Promise((resolve) => {
    pending.set(id, resolve);
    out({ type: "control_request", request_id: id, request: payload });
  });
}

async function canUseTool(toolName, input) {
  const response = await request({
    subtype: "can_use_tool",
    tool_name: toolName,
    display_name: toolName,
    input,
    tool_use_id: `toolu_${randomUUID().slice(0, 8)}`,
  });
  return (
    response.response ?? {
      behavior: "deny",
      message: response.error ?? "error",
    }
  );
}

async function mcp(message) {
  const response = await request({
    subtype: "mcp_message",
    server_name: "dyad",
    message: { jsonrpc: "2.0", ...message },
  });
  return response.response?.mcp_response ?? null;
}

const usageBlock = {
  input_tokens: 4,
  cache_creation_input_tokens: 13087,
  cache_read_input_tokens: 12371,
  output_tokens: 671,
  cache_creation: {
    ephemeral_5m_input_tokens: 0,
    ephemeral_1h_input_tokens: 13087,
  },
};

function assistantText(text) {
  out({
    type: "assistant",
    message: {
      model: resolvedModel,
      id: `msg_${randomUUID().slice(0, 8)}`,
      role: "assistant",
      content: [{ type: "text", text }],
      usage: usageBlock,
    },
    parent_tool_use_id: null,
    session_id: sessionId,
  });
}

async function streamText(text, { delayMs = 0 } = {}) {
  out({
    type: "stream_event",
    event: { type: "message_start", message: { model: resolvedModel } },
    parent_tool_use_id: null,
  });
  out({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    parent_tool_use_id: null,
  });
  const chunks = text.match(/.{1,12}/gs) ?? [];
  for (const chunk of chunks) {
    if (interrupted) break;
    out({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: chunk },
      },
      parent_tool_use_id: null,
    });
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  assistantText(text);
  out({
    type: "stream_event",
    event: { type: "content_block_stop", index: 0 },
    parent_tool_use_id: null,
  });
}

function toolUse(id, name, input) {
  out({
    type: "assistant",
    message: {
      model: resolvedModel,
      id: `msg_${randomUUID().slice(0, 8)}`,
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
      usage: usageBlock,
    },
    parent_tool_use_id: null,
    session_id: sessionId,
  });
}

function toolResult(id, content, isError = false) {
  out({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: id, content, is_error: isError },
      ],
    },
    parent_tool_use_id: null,
    session_id: sessionId,
  });
}

let finished = false;
function result({
  isError = false,
  subtype = "success",
  text = "",
  modelUsageOverride = null,
  includeUsage = true,
} = {}) {
  finished = true;
  const modelUsage = modelUsageOverride ?? {
    "claude-haiku-4-5-20251001": {
      inputTokens: 907,
      outputTokens: 12,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0.000967,
      canonicalModel: "claude-haiku-4-5",
      costBasis: "list",
    },
    [resolvedModel]: {
      inputTokens: 4,
      outputTokens: 671,
      cacheReadInputTokens: 12371,
      cacheCreationInputTokens: 13087,
      costUSD: 0.0615402,
      canonicalModel: resolvedModel,
      costBasis: "list",
    },
  };
  out({
    type: "result",
    subtype,
    is_error: isError,
    duration_ms: 10,
    duration_api_ms: 5,
    num_turns: 1,
    stop_reason: isError ? null : "end_turn",
    session_id: sessionId,
    total_cost_usd: 0.0625072,
    ...(includeUsage ? { usage: usageBlock, modelUsage } : {}),
    result: text,
    permission_denials: [],
  });
  if (stdinClosed) process.exit(0);
}

function scenarioFromPrompt() {
  const content = userMessage?.content;
  const text =
    typeof content === "string"
      ? content
      : (content ?? [])
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n");
  const match = text.match(/\[scenario:([a-z0-9-]+)\]/);
  return match?.[1] ?? process.env.FAKE_CLAUDE_SCENARIO ?? "write-file";
}

async function run() {
  const scenario = scenarioFromPrompt();
  logInvocation({ scenario, resumeSessionId, requestedSessionId, sessionId });
  out({
    type: "system",
    subtype: "init",
    cwd: process.cwd(),
    session_id: sessionId,
    tools,
    mcp_servers: [{ name: "dyad", status: "connected" }],
    model: resolvedModel,
    permissionMode: flag("--permission-mode") ?? "default",
    apiKeySource: process.env.FAKE_CLAUDE_API_KEY_SOURCE ?? "none",
    claude_code_version: process.env.FAKE_CLAUDE_VERSION ?? "2.1.260",
  });

  switch (scenario) {
    case "write-file": {
      await streamText("Creating the file now.");
      const filePath = path.join(process.cwd(), "src", "claude-created.txt");
      const input = { file_path: filePath, content: "hello from claude\n" };
      const decision = await canUseTool("Write", input);
      const id = "toolu_write1";
      toolUse(id, "Write", input);
      if (decision.behavior === "allow") {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, input.content);
        toolResult(id, `File created successfully at: ${filePath}`);
      } else {
        toolResult(id, decision.message, true);
      }
      await streamText("Done.");
      result();
      return;
    }
    case "resume-check": {
      await streamText(`resumed:${resumeSessionId ?? "none"}`);
      result();
      return;
    }
    case "bash": {
      const decision = await canUseTool("Bash", { command: "ls -la" });
      await streamText(`Bash ${decision.behavior}: ${decision.message ?? ""}`);
      result();
      return;
    }
    case "edit-attempt": {
      const filePath = path.join(process.cwd(), "src", "ask-mode.txt");
      const decision = await canUseTool("Write", {
        file_path: filePath,
        content: "x",
      });
      if (decision.behavior === "allow") {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, "x");
      }
      await streamText(`Write ${decision.behavior}: ${decision.message ?? ""}`);
      result();
      return;
    }
    case "mcp-read-logs": {
      const init = await mcp({
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });
      await mcp({ method: "notifications/initialized" });
      const list = await mcp({ id: 1, method: "tools/list" });
      const names = (list?.result?.tools ?? []).map((tool) => tool.name);
      const id = "toolu_mcp1";
      const input = { limit: 5 };
      const decision = await canUseTool("mcp__dyad__read_logs", input);
      toolUse(id, "mcp__dyad__read_logs", input);
      let text = `denied: ${decision.message ?? ""}`;
      if (decision.behavior === "allow") {
        const call = await mcp({
          id: 2,
          method: "tools/call",
          params: { name: "read_logs", arguments: input },
        });
        text =
          call?.result?.content?.map((c) => c.text).join("") ?? "no content";
        toolResult(id, text, Boolean(call?.result?.isError));
      } else {
        toolResult(id, text, true);
      }
      await streamText(
        `server:${init?.result?.serverInfo?.name} tools:${names.join("|")} logs:${text.slice(0, 40)}`,
      );
      result();
      return;
    }
    case "mcp-add-dependency": {
      await mcp({
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });
      const input = { packages: ["left-pad"] };
      const decision = await canUseTool("mcp__dyad__add_dependency", input);
      await streamText(
        `add_dependency ${decision.behavior}: ${decision.message ?? ""}`,
      );
      result();
      return;
    }
    case "mcp-bad-args": {
      await mcp({
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });
      const call = await mcp({
        id: 2,
        method: "tools/call",
        params: {
          name: "add_dependency",
          arguments: { packages: ["https://evil.example/x.tgz"] },
        },
      });
      const unknown = await mcp({
        id: 3,
        method: "tools/call",
        params: { name: "shell", arguments: {} },
      });
      await streamText(
        `bad-args isError:${call?.result?.isError} unknown:${unknown?.error?.code ?? "none"}`,
      );
      result();
      return;
    }
    case "slow": {
      await streamText(
        "Slowly writing a very long essay about rivers. ".repeat(40),
        { delayMs: 150 },
      );
      if (interrupted) {
        out({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "text", text: "[Request interrupted by user]" }],
          },
          parent_tool_use_id: null,
          session_id: sessionId,
        });
        result({ text: "" });
        return;
      }
      result();
      return;
    }
    case "not-logged-in": {
      out({
        type: "assistant",
        message: {
          model: "<synthetic>",
          id: randomUUID(),
          role: "assistant",
          content: [
            { type: "text", text: "Not logged in · Please run /login" },
          ],
          stop_reason: "stop_sequence",
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        parent_tool_use_id: null,
        session_id: sessionId,
      });
      result({
        text: "Not logged in · Please run /login",
        includeUsage: false,
        modelUsageOverride: {},
      });
      return;
    }
    case "session-missing": {
      process.stderr.write(
        `No conversation found with session ID: ${resumeSessionId}\n`,
      );
      result({
        isError: true,
        subtype: "error_during_execution",
        includeUsage: false,
      });
      return;
    }
    case "crash": {
      await streamText("About to crash");
      logInvocation({ crashed: true });
      process.exit(1);
    }
    // eslint-disable-next-line no-fallthrough
    case "unknown-model": {
      await streamText("Mystery model reply.");
      result({
        modelUsageOverride: {
          "claude-mystery-9": {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            canonicalModel: "claude-mystery-9",
            costBasis: "list",
          },
        },
      });
      return;
    }
    default: {
      await streamText(`Unknown scenario ${scenario}`);
      result();
    }
  }
}
