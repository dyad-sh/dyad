/**
 * Handler for Local Agent E2E testing fixtures
 * Manages multi-turn tool call conversations
 */

import { Request, Response } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import type { LocalAgentFixture, ToolCall, Turn } from "./localAgentTypes";
import { resolveFixturesDir } from "./paths";
import { fakeLlmLog } from "./log";

// Register ts-node to allow loading .ts fixture files directly
try {
  require("ts-node/register");
} catch {
  // ts-node not available, will fall back to .js files
}

// Map of session ID -> current turn index

// Cache loaded fixtures to avoid re-importing
const fixtureCache = new Map<string, LocalAgentFixture>();

// Track connection attempts per session+turn for connection drop simulation.
// Key: `${sessionId}-${passIndex}-${turnIndex}`, Value: attempt count
const connectionAttempts = new Map<string, number>();

function normalizeFixtureText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function parseTagAttributes(source: string): Record<string, string> {
  return Object.fromEntries(
    [...source.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}

/**
 * Convert the retired Build-mode XML fixture format into native tool turns.
 * This keeps older E2E scenarios useful while ensuring they exercise the same
 * tool-calling path as the application.
 */
export function convertLegacyFixtureToLocalAgent(
  source: string,
): LocalAgentFixture {
  const normalized = normalizeFixtureText(source);
  const turns: Turn[] = [];
  const tagPattern =
    /<dyad-(write|delete|rename|add-dependency|execute-sql|search-replace|add-integration|chat-summary)\b([^>]*)>([\s\S]*?)<\/dyad-\1>/g;
  let precedingEnd = 0;

  for (const match of normalized.matchAll(tagPattern)) {
    const [fullMatch, tag, attributeSource, rawBody] = match;
    const index = match.index ?? 0;
    const text = normalized.slice(precedingEnd, index).trim();
    const attributes = parseTagAttributes(attributeSource);
    const body = rawBody.replace(/^\n|\n$/g, "");
    let toolCall: ToolCall | undefined;

    switch (tag) {
      case "write":
        toolCall = {
          name: "write_file",
          args: {
            path: attributes.path,
            content: body,
            ...(attributes.description
              ? { description: attributes.description }
              : {}),
          },
        };
        break;
      case "delete":
        toolCall = { name: "delete_file", args: { path: attributes.path } };
        break;
      case "rename":
        toolCall = {
          name: "rename_file",
          args: { from: attributes.from, to: attributes.to },
        };
        break;
      case "add-dependency":
        toolCall = {
          name: "add_dependency",
          args: { packages: attributes.packages.split(/\s+/).filter(Boolean) },
        };
        break;
      case "execute-sql":
        toolCall = {
          name: "execute_sql",
          args: {
            query: body.trim(),
            ...(attributes.description
              ? { description: attributes.description }
              : {}),
          },
        };
        break;
      case "search-replace": {
        const replacement = body.match(
          /^<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE$/,
        );
        if (replacement) {
          toolCall = {
            name: "search_replace",
            args: {
              file_path: attributes.path,
              old_string: replacement[1],
              new_string: replacement[2],
            },
          };
        }
        break;
      }
      case "add-integration":
        toolCall = { name: "add_integration", args: {} };
        break;
      case "chat-summary":
        toolCall = {
          name: "set_chat_summary",
          args: { summary: body.trim() },
        };
        break;
    }

    if (toolCall) {
      turns.push({ ...(text ? { text } : {}), toolCalls: [toolCall] });
    }
    precedingEnd = index + fullMatch.length;
  }

  const trailingText = normalized.slice(precedingEnd).trim();
  if (trailingText || turns.length === 0) {
    turns.push({ text: trailingText || normalized.trim() || "Done." });
  }

  return {
    description: "Converted legacy Build-mode E2E fixture",
    turns,
  };
}

function findLegacyFixturePath(fixtureName: string): string | undefined {
  for (const fixturePath of [
    path.join(resolveFixturesDir(), `${fixtureName}.md`),
    path.join(resolveFixturesDir(), "engine", `${fixtureName}.md`),
  ]) {
    if (fs.existsSync(fixturePath)) return fixturePath;
  }
  return undefined;
}

function hasLocalAgentFixture(fixtureName: string): boolean {
  const fixtureDir = path.join(resolveFixturesDir(), "engine", "local-agent");
  return (
    fs.existsSync(path.join(fixtureDir, `${fixtureName}.ts`)) ||
    fs.existsSync(path.join(fixtureDir, `${fixtureName}.js`)) ||
    Boolean(findLegacyFixturePath(fixtureName))
  );
}

/**
 * Generate a session ID from the first user message
 * This allows us to track conversation state across requests
 */
function getSessionId(messages: any[]): string {
  // Find the first user message to use as session identifier
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) {
    return crypto.randomUUID();
  }
  return crypto
    .createHash("md5")
    .update(JSON.stringify(firstUserMsg))
    .digest("hex");
}

/**
 * Check if a message content contains a todo reminder pattern.
 * The todo reminder is injected by the outer loop when there are incomplete todos.
 */
function isTodoReminderMessage(msg: any): boolean {
  if (msg?.role !== "user") return false;
  const content = Array.isArray(msg.content)
    ? msg.content.find((p: any) => p.type === "text")?.text
    : typeof msg.content === "string"
      ? msg.content
      : null;
  // Note: This magic string must match the reminder text in prepare_step_utils.ts
  // buildTodoReminderMessage(). Update both if the text changes.
  return content?.includes("incomplete todo(s)") ?? false;
}

function isToolResultMessage(msg: any): boolean {
  if (msg?.role === "tool") {
    return true;
  }
  return (
    Array.isArray(msg?.content) &&
    msg.content.some(
      (p: any) => p.type === "tool-result" || p.type === "tool_result",
    )
  );
}

/**
 * Count the number of todo reminder messages in the conversation.
 * This determines which outer loop pass we're on.
 */
function countTodoReminderMessages(messages: any[]): number {
  return messages.filter(isTodoReminderMessage).length;
}

/**
 * Count the number of tool result messages AFTER the last user message
 * to determine which turn we're on for the current fixture.
 * This ensures each new user prompt (fixture trigger) starts fresh at turn 0.
 */
function countToolResultRounds(messages: any[]): number {
  // Find the index of the last user prompt. Anthropic encodes tool results as
  // user messages, so skip those or every tool-result follow-up resets to turn 0.
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user" && !isToolResultMessage(messages[i])) {
      lastUserIndex = i;
      break;
    }
  }

  // Count tool results only after the last user message
  let rounds = 0;
  for (let i = lastUserIndex + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (isToolResultMessage(msg)) {
      rounds++;
    }
  }
  return rounds;
}

/**
 * Extract the attachment path from the last user message.
 * The user message format includes: "path: /path/to/app/.dyad/media/hash.png"
 */
function extractAttachmentPath(messages: any[]): string | null {
  // Search from the end to find the most recent user message with an attachment path
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const text = Array.isArray(msg.content)
      ? msg.content.find((p: any) => p.type === "text")?.text
      : typeof msg.content === "string"
        ? msg.content
        : null;
    if (!text) continue;
    const match = text.match(/\(path: ([^\s)]+)\)/);
    if (match) return match[1];
  }
  return null;
}

function extractSyntheticUsage(messages: any[]): Turn["usage"] | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = Array.isArray(message.content)
      ? message.content.find((part: any) => part.type === "text")?.text
      : typeof message.content === "string"
        ? message.content
        : null;
    if (!text || text.startsWith("Summarize the following chat:")) continue;
    const match = text.match(/\[high-tokens=(\d+)\]/);
    if (!match) continue;
    const totalTokens = Number(match[1]);
    return {
      prompt_tokens: Math.max(0, totalTokens - 100),
      completion_tokens: Math.min(100, totalTokens),
      total_tokens: totalTokens,
    };
  }
  return undefined;
}

/**
 * Load a fixture file dynamically
 * Tries .ts first (for dev mode with ts-node), then .js
 */
export async function loadLocalAgentFixture(
  fixtureName: string,
): Promise<LocalAgentFixture> {
  if (fixtureCache.has(fixtureName)) {
    return fixtureCache.get(fixtureName)!;
  }

  const fixtureDir = path.join(resolveFixturesDir(), "engine", "local-agent");

  // Try .ts first, then .js
  let fixturePath = path.join(fixtureDir, `${fixtureName}.ts`);
  if (!fs.existsSync(fixturePath)) {
    fixturePath = path.join(fixtureDir, `${fixtureName}.js`);
  }

  if (!fs.existsSync(fixturePath)) {
    const legacyFixturePath = findLegacyFixturePath(fixtureName);
    if (!legacyFixturePath) {
      throw new Error(`Local agent fixture not found: ${fixtureName}`);
    }
    const fixture = convertLegacyFixtureToLocalAgent(
      fs.readFileSync(legacyFixturePath, "utf-8"),
    );
    fixtureCache.set(fixtureName, fixture);
    return fixture;
  }

  try {
    // Clear require cache to allow fixture updates during development
    delete require.cache[require.resolve(fixturePath)];
    const module = require(fixturePath);
    const fixture = module.fixture as LocalAgentFixture;

    if (!fixture || (!fixture.turns && !fixture.passes)) {
      throw new Error(
        `Invalid fixture: missing 'fixture' export or 'turns'/'passes' array`,
      );
    }

    fixtureCache.set(fixtureName, fixture);
    return fixture;
  } catch (error) {
    console.error(`Failed to load fixture: ${fixturePath}`, error);
    throw error;
  }
}

/**
 * Get the turns for the current pass from a fixture.
 * Supports both simple fixtures (with `turns`) and multi-pass fixtures (with `passes`).
 */
function getTurnsForPass(
  fixture: LocalAgentFixture,
  passIndex: number,
): Turn[] {
  // If fixture uses passes, get the appropriate pass
  if (fixture.passes && fixture.passes.length > 0) {
    if (passIndex >= fixture.passes.length) {
      // All passes exhausted
      return [];
    }
    return fixture.passes[passIndex].turns;
  }

  // Simple fixture with turns - only valid for pass 0
  if (passIndex > 0) {
    return [];
  }
  return fixture.turns || [];
}

/**
 * Create a streaming chunk in OpenAI format
 */
function createStreamChunk(
  content: string,
  role: string = "assistant",
  isLast: boolean = false,
  finishReason: string | null = null,
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  },
) {
  const chunk: any = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "fake-local-agent-model",
    choices: [
      {
        index: 0,
        delta: isLast ? {} : { content, role },
        finish_reason: finishReason,
      },
    ],
  };
  if (isLast && usage) {
    chunk.usage = usage;
  }
  return `data: ${JSON.stringify(chunk)}\n\n${isLast ? "data: [DONE]\n\n" : ""}`;
}

/**
 * Stream a text-only turn response
 */
async function streamTextResponse(
  res: Response,
  text: string,
  usage?: Turn["usage"],
  protocol: "openai" | "anthropic" = "openai",
) {
  text = normalizeFixtureText(text);

  if (protocol === "anthropic") {
    await streamAnthropicTextResponse(res, text, usage);
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Send role first
  res.write(createStreamChunk("", "assistant"));

  // Stream text in batches
  const batchSize = 32;
  for (let i = 0; i < text.length; i += batchSize) {
    const batch = text.slice(i, i + batchSize);
    res.write(createStreamChunk(batch));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  // Send final chunk
  res.write(createStreamChunk("", "assistant", true, "stop", usage));
  res.end();
}

/**
 * Stream a turn with tool calls
 */
async function streamToolCallResponse(
  res: Response,
  turn: Turn,
  options?: {
    dropAfterToolCalls?: boolean;
    protocol?: "openai" | "anthropic";
  },
) {
  if (options?.protocol === "anthropic") {
    await streamAnthropicToolCallResponse(res, turn, {
      dropAfterToolCalls: options.dropAfterToolCalls,
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const now = Date.now();
  const mkChunk = (delta: any, finish: string | null = null) => {
    const chunk = {
      id: `chatcmpl-${now}`,
      object: "chat.completion.chunk",
      created: Math.floor(now / 1000),
      model: "fake-local-agent-model",
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finish,
        },
      ],
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  };

  // 1) Send role
  res.write(mkChunk({ role: "assistant" }));

  // 2) Send text content if any
  if (turn.text) {
    const text = normalizeFixtureText(turn.text);
    const batchSize = 32;
    for (let i = 0; i < text.length; i += batchSize) {
      const batch = text.slice(i, i + batchSize);
      res.write(mkChunk({ content: batch }));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  // 3) Send tool calls
  if (turn.toolCalls && turn.toolCalls.length > 0) {
    for (let idx = 0; idx < turn.toolCalls.length; idx++) {
      const toolCall = turn.toolCalls[idx];
      const toolCallId = `call_${now}_${idx}`;

      // Send tool call init with id + name + empty args
      res.write(
        mkChunk({
          tool_calls: [
            {
              index: idx,
              id: toolCallId,
              type: "function",
              function: {
                name: toolCall.name,
                arguments: "",
              },
            },
          ],
        }),
      );

      // Stream arguments gradually
      const args = JSON.stringify(toolCall.args);
      const argBatchSize = 20;
      for (let i = 0; i < args.length; i += argBatchSize) {
        const part = args.slice(i, i + argBatchSize);
        res.write(
          mkChunk({
            tool_calls: [{ index: idx, function: { arguments: part } }],
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  }

  if (options?.dropAfterToolCalls) {
    fakeLlmLog(
      `[local-agent] Simulating connection drop after streaming tool calls`,
    );
    // Drop before finish_reason/[DONE] so tool calls were emitted but the
    // provider response did not complete.
    res.socket?.destroy();
    return;
  }

  // 4) Send finish (with optional usage data)
  const finishReason =
    turn.toolCalls && turn.toolCalls.length > 0 ? "tool_calls" : "stop";
  const finishChunk: any = {
    id: `chatcmpl-${now}`,
    object: "chat.completion.chunk",
    created: Math.floor(now / 1000),
    model: "fake-local-agent-model",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
  };
  if (turn.usage) {
    finishChunk.usage = turn.usage;
  }
  res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);

  res.write("data: [DONE]\n\n");
  res.end();
}

function writeAnthropicEvent(res: Response, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function startAnthropicStream(res: Response, usage?: Turn["usage"]) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  writeAnthropicEvent(res, "message_start", {
    type: "message_start",
    message: {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: "fake-local-agent-model",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: usage?.prompt_tokens ?? 1,
        output_tokens: 0,
      },
    },
  });
}

async function streamAnthropicTextBlock(
  res: Response,
  index: number,
  text: string,
) {
  text = normalizeFixtureText(text);

  writeAnthropicEvent(res, "content_block_start", {
    type: "content_block_start",
    index,
    content_block: { type: "text", text: "" },
  });
  const batchSize = 32;
  for (let i = 0; i < text.length; i += batchSize) {
    const batch = text.slice(i, i + batchSize);
    writeAnthropicEvent(res, "content_block_delta", {
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text: batch },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  writeAnthropicEvent(res, "content_block_stop", {
    type: "content_block_stop",
    index,
  });
}

function finishAnthropicStream(
  res: Response,
  stopReason: "end_turn" | "tool_use",
  usage?: Turn["usage"],
) {
  writeAnthropicEvent(res, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: {
      input_tokens: usage?.prompt_tokens ?? 1,
      output_tokens: usage?.completion_tokens ?? 1,
    },
  });
  writeAnthropicEvent(res, "message_stop", { type: "message_stop" });
  res.end();
}

async function streamAnthropicTextResponse(
  res: Response,
  text: string,
  usage?: Turn["usage"],
) {
  startAnthropicStream(res, usage);
  await streamAnthropicTextBlock(res, 0, text);
  finishAnthropicStream(res, "end_turn", usage);
}

async function streamAnthropicToolCallResponse(
  res: Response,
  turn: Turn,
  options?: { dropAfterToolCalls?: boolean },
) {
  startAnthropicStream(res, turn.usage);

  let blockIndex = 0;
  if (turn.text) {
    await streamAnthropicTextBlock(res, blockIndex++, turn.text);
  }

  if (turn.toolCalls && turn.toolCalls.length > 0) {
    for (let idx = 0; idx < turn.toolCalls.length; idx++) {
      const toolCall = turn.toolCalls[idx];
      const toolCallId = `call_${Date.now()}_${idx}`;
      writeAnthropicEvent(res, "content_block_start", {
        type: "content_block_start",
        index: blockIndex,
        content_block: {
          type: "tool_use",
          id: toolCallId,
          name: toolCall.name,
          input: {},
        },
      });

      const args = JSON.stringify(toolCall.args);
      const argBatchSize = 20;
      for (let i = 0; i < args.length; i += argBatchSize) {
        const part = args.slice(i, i + argBatchSize);
        writeAnthropicEvent(res, "content_block_delta", {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "input_json_delta", partial_json: part },
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      writeAnthropicEvent(res, "content_block_stop", {
        type: "content_block_stop",
        index: blockIndex,
      });
      blockIndex++;
    }
  }

  if (options?.dropAfterToolCalls) {
    fakeLlmLog(
      `[local-agent] Simulating Anthropic connection drop after streaming tool calls`,
    );
    res.socket?.destroy();
    return;
  }

  finishAnthropicStream(
    res,
    turn.toolCalls && turn.toolCalls.length > 0 ? "tool_use" : "end_turn",
    turn.usage,
  );
}

/**
 * Handle a local-agent fixture request
 */
export async function handleLocalAgentFixture(
  req: Request,
  res: Response,
  fixtureName: string,
  options: { protocol?: "openai" | "anthropic" } = {},
): Promise<void> {
  const { messages = [] } = req.body;
  const protocol = options.protocol ?? "openai";

  fakeLlmLog(`[local-agent] Loading fixture: ${fixtureName}`);
  fakeLlmLog(`[local-agent] Messages count: ${messages.length}`);

  try {
    const fixture = await loadLocalAgentFixture(fixtureName);
    const sessionId = getSessionId(messages);

    // Determine which outer loop pass we're on based on todo reminder messages
    const passIndex = countTodoReminderMessages(messages);

    // Determine which turn we're on within the current pass
    const toolResultRounds = countToolResultRounds(messages);
    const turnIndex = toolResultRounds;

    // Get the turns for the current pass
    const turns = getTurnsForPass(fixture, passIndex);

    fakeLlmLog(
      `[local-agent] Loaded fixture: ${fixtureName}, Session: ${sessionId}, Pass: ${passIndex}, Turn: ${turnIndex}, Tool rounds: ${toolResultRounds}`,
    );

    if (turnIndex >= turns.length) {
      // All turns exhausted for this pass, send a simple completion message
      fakeLlmLog(
        `[local-agent] All turns exhausted for pass ${passIndex}, sending completion`,
      );
      await streamTextResponse(res, "Task completed.", undefined, protocol);
      return;
    }

    let turn = turns[turnIndex];
    const syntheticUsage = extractSyntheticUsage(messages);
    if (syntheticUsage && !turn.toolCalls?.length) {
      turn = { ...turn, usage: syntheticUsage };
    }
    fakeLlmLog(
      `[local-agent] Executing pass ${passIndex}, turn ${turnIndex}:`,
      {
        hasText: !!turn.text,
        toolCallCount: turn.toolCalls?.length ?? 0,
      },
    );

    // Replace {{ATTACHMENT_PATH}} placeholders in tool call args
    // with the actual path extracted from the user message
    if (turn.toolCalls) {
      const attachmentPath = extractAttachmentPath(messages);
      if (attachmentPath) {
        turn = {
          ...turn,
          toolCalls: turn.toolCalls.map((tc) => ({
            ...tc,
            args: JSON.parse(
              JSON.stringify(tc.args).replace(
                /\{\{ATTACHMENT_PATH\}\}/g,
                JSON.stringify(attachmentPath).slice(1, -1),
              ),
            ),
          })),
        };
      }
    }

    // Check if we should simulate a connection drop for this attempt
    const turnScopedDropAttempts =
      fixture.dropConnectionByTurn?.find((rule) => rule.turnIndex === turnIndex)
        ?.attempts ?? fixture.dropConnectionOnAttempts;
    const turnScopedDropAfterToolCallAttempts =
      fixture.dropConnectionAfterToolCallByTurn?.find(
        (rule) => rule.turnIndex === turnIndex,
      )?.attempts;

    if (turnScopedDropAttempts && turnScopedDropAttempts.length > 0) {
      const attemptKey = `${sessionId}-${passIndex}-${turnIndex}`;
      const currentAttempt = (connectionAttempts.get(attemptKey) || 0) + 1;
      connectionAttempts.set(attemptKey, currentAttempt);

      fakeLlmLog(
        `[local-agent] Connection attempt ${currentAttempt} for ${attemptKey}, ` +
          `drop on: [${turnScopedDropAttempts.join(", ")}]`,
      );

      if (turnScopedDropAttempts.includes(currentAttempt)) {
        fakeLlmLog(
          `[local-agent] Simulating connection drop on attempt ${currentAttempt}`,
        );
        // Stream partial data then destroy the socket to simulate a network interruption
        if (protocol === "anthropic") {
          startAnthropicStream(res);
          writeAnthropicEvent(res, "content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          });
          writeAnthropicEvent(res, "content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "text_delta",
              text: "Partial response before connection dr",
            },
          });
        } else {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.write(
            createStreamChunk(
              "Partial response before connection dr",
              "assistant",
            ),
          );
        }
        // Destroy the underlying socket to trigger a "terminated" error on the client
        res.socket?.destroy();
        return;
      }
    }

    // Optional delay so tests can cancel the stream while it is still open.
    // Watch the response: the request can close normally as soon as its body is
    // consumed, before the response starts streaming.
    if (turn.delayMs && turn.delayMs > 0) {
      let aborted = false;
      await new Promise<void>((resolve) => {
        const onClose = () => {
          aborted = true;
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          res.removeListener("close", onClose);
          resolve();
        }, turn.delayMs);
        res.once("close", onClose);
      });
      if (aborted || res.destroyed) {
        return;
      }
    }

    // If this turn has tool calls, stream them
    if (turn.toolCalls && turn.toolCalls.length > 0) {
      const dropAfterToolCalls =
        turnScopedDropAfterToolCallAttempts &&
        turnScopedDropAfterToolCallAttempts.length > 0
          ? (() => {
              const attemptKey = `${sessionId}-${passIndex}-${turnIndex}-after-tool-call`;
              const currentAttempt =
                (connectionAttempts.get(attemptKey) || 0) + 1;
              connectionAttempts.set(attemptKey, currentAttempt);
              return turnScopedDropAfterToolCallAttempts.includes(
                currentAttempt,
              );
            })()
          : false;

      await streamToolCallResponse(res, turn, {
        dropAfterToolCalls,
        protocol,
      });
    } else {
      // Text-only turn
      await streamTextResponse(res, turn.text || "Done.", turn.usage, protocol);
    }
  } catch (error) {
    console.error(`[local-agent] Error handling fixture:`, error);
    res.status(500).json({
      error: {
        message: `Failed to load fixture: ${fixtureName}`,
        type: "server_error",
      },
    });
  }
}

/**
 * Check if a message content matches a local-agent fixture pattern
 * Returns the fixture name if matched, null otherwise
 */
export function extractLocalAgentFixture(content: string): string | null {
  if (!content) return null;
  if (content.startsWith("Fix error: Error Line 6 error")) {
    return "fix-runtime-error";
  }
  if (content.startsWith("Fix all of the following errors:")) {
    return "fix-all-runtime-errors";
  }
  if (content.includes("TypeScript compile-time error")) {
    return "fix-typescript-errors";
  }
  if (
    content.startsWith("Please fix the following security issue") ||
    /^Please fix the following \d+ security issues/.test(content)
  ) {
    return "security-fix";
  }
  // Prefer the explicit tool-loop fixture namespace, then adapt an existing
  // legacy fixture when a Build-mode E2E still uses tc=FIXTURE_NAME.
  const explicitMatch = content.trim().match(/^tc=local-agent\/([^\s[]+)/);
  if (explicitMatch) return explicitMatch[1];

  const legacyMatch = content.trim().match(/^tc=([^\s[]+)/);
  return legacyMatch && hasLocalAgentFixture(legacyMatch[1])
    ? legacyMatch[1]
    : null;
}
