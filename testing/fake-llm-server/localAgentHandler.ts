/**
 * Handler for Local Agent E2E testing fixtures
 * Manages multi-turn tool call conversations
 */

import { Request, Response } from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import type { LocalAgentFixture, Turn } from "./localAgentTypes";

// Register ts-node to allow loading .ts fixture files directly
try {
  require("ts-node/register");
} catch {
  // ts-node not available, will fall back to .js files
}

// Map of session ID -> current turn index

// Cache loaded fixtures to avoid re-importing
const fixtureCache = new Map<string, LocalAgentFixture>();

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
 * Count the number of tool result messages to determine which turn we're on
 */
function countToolResultRounds(messages: any[]): number {
  let rounds = 0;
  for (const msg of messages) {
    if (msg?.role === "tool") {
      rounds++;
    } else if (Array.isArray(msg?.content)) {
      if (msg.content.some((p: any) => p.type === "tool-result")) {
        rounds++;
      }
    }
  }
  return rounds;
}

/**
 * Load a fixture file dynamically
 * Tries .ts first (for dev mode with ts-node), then .js
 */
async function loadFixture(fixtureName: string): Promise<LocalAgentFixture> {
  if (fixtureCache.has(fixtureName)) {
    return fixtureCache.get(fixtureName)!;
  }

  const fixtureDir = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "e2e-tests",
    "fixtures",
    "engine",
    "local-agent",
  );

  // Try .ts first, then .js
  let fixturePath = path.join(fixtureDir, `${fixtureName}.ts`);
  if (!fs.existsSync(fixturePath)) {
    fixturePath = path.join(fixtureDir, `${fixtureName}.js`);
  }

  try {
    // Clear require cache to allow fixture updates during development
    delete require.cache[require.resolve(fixturePath)];
    const module = require(fixturePath);
    const fixture = module.fixture as LocalAgentFixture;

    if (!fixture || !fixture.turns) {
      throw new Error(
        `Invalid fixture: missing 'fixture' export or 'turns' array`,
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
 * Create a streaming chunk in OpenAI format
 */
function createStreamChunk(
  content: string,
  role: string = "assistant",
  isLast: boolean = false,
  finishReason: string | null = null,
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
  return `data: ${JSON.stringify(chunk)}\n\n${isLast ? "data: [DONE]\n\n" : ""}`;
}

/**
 * Stream a text-only turn response
 */
async function streamTextResponse(res: Response, text: string) {
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
  res.write(createStreamChunk("", "assistant", true, "stop"));
  res.end();
}

/**
 * Stream a turn with tool calls
 */
async function streamToolCallResponse(res: Response, turn: Turn) {
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
    const batchSize = 32;
    for (let i = 0; i < turn.text.length; i += batchSize) {
      const batch = turn.text.slice(i, i + batchSize);
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

  // 4) Send finish
  const finishReason =
    turn.toolCalls && turn.toolCalls.length > 0 ? "tool_calls" : "stop";
  res.write(mkChunk({}, finishReason));
  res.write("data: [DONE]\n\n");
  res.end();
}

/**
 * Handle a local-agent fixture request
 */
export async function handleLocalAgentFixture(
  req: Request,
  res: Response,
  fixtureName: string,
): Promise<void> {
  const { messages = [] } = req.body;

  console.log(`[local-agent] Loading fixture: ${fixtureName}`);
  console.log(`[local-agent] Messages count: ${messages.length}`);

  try {
    const fixture = await loadFixture(fixtureName);
    const sessionId = getSessionId(messages);

    // Determine which turn we're on based on tool result rounds
    const toolResultRounds = countToolResultRounds(messages);
    const turnIndex = toolResultRounds;

    console.log(
      `[local-agent] Session: ${sessionId}, Turn: ${turnIndex}, Tool rounds: ${toolResultRounds}`,
    );

    if (turnIndex >= fixture.turns.length) {
      // All turns exhausted, send a simple completion message
      console.log(`[local-agent] All turns exhausted, sending completion`);
      await streamTextResponse(res, "Task completed.");
      return;
    }

    const turn = fixture.turns[turnIndex];
    console.log(`[local-agent] Executing turn ${turnIndex}:`, {
      hasText: !!turn.text,
      toolCallCount: turn.toolCalls?.length ?? 0,
    });

    // If this turn has tool calls, stream them
    if (turn.toolCalls && turn.toolCalls.length > 0) {
      await streamToolCallResponse(res, turn);
    } else {
      // Text-only turn
      await streamTextResponse(res, turn.text || "Done.");
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
  // Match tc=local-agent/FIXTURE_NAME, allowing trailing whitespace
  const match = content.trim().match(/^tc=local-agent\/([^\s[]+)/);
  return match ? match[1] : null;
}
