/**
 * Handler for OpenAI Responses API (/v1/responses)
 * Implements the streaming SSE format for the Responses API
 */

import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { CANNED_MESSAGE } from ".";

/**
 * Generate a dump file from the request and return the path marker
 */
function generateDump(req: Request): string {
  const timestamp = Date.now();
  const generatedDir = path.join(__dirname, "generated");

  // Create generated directory if it doesn't exist
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const dumpFilePath = path.join(generatedDir, `${timestamp}.json`);

  try {
    fs.writeFileSync(
      dumpFilePath,
      JSON.stringify(
        {
          body: req.body,
          headers: { authorization: req.headers["authorization"] },
        },
        null,
        2,
      ).replace(/\r\n/g, "\n"),
      "utf-8",
    );
    console.log(`* [responses] Dumped messages to: ${dumpFilePath}`);
    return `[[dyad-dump-path=${dumpFilePath}]]`;
  } catch (error) {
    console.error(`* [responses] Error writing dump file: ${error}`);
    return `Error: Could not write dump file: ${error}`;
  }
}

/**
 * Extract text content from the Responses API input format
 */
function extractTextFromInput(input: unknown): string {
  // Responses API accepts `input` as a string or a list of structured items.
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";

  for (const item of input.slice().reverse()) {
    if (item?.role === "user" && typeof item?.content === "string") {
      return item.content;
    }
    if (item?.role === "user" && Array.isArray(item?.content)) {
      // Try common part types used by clients.
      for (const part of item.content) {
        if (part?.type === "input_text" && typeof part?.text === "string") {
          return part.text;
        }
        if (part?.type === "text" && typeof part?.text === "string") {
          return part.text;
        }
      }
    }
  }
  return "";
}

function extractTextFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (const msg of messages.slice().reverse()) {
    if (msg?.role !== "user") continue;
    if (typeof msg?.content === "string") return msg.content;
    if (Array.isArray(msg?.content)) {
      for (const part of msg.content) {
        if (part?.type === "text" && typeof part?.text === "string") {
          return part.text;
        }
      }
    }
  }
  return "";
}

function extractTestCaseName(promptText: string): string | null {
  // Matches:
  // - "tc=foo"
  // - "[dump] tc=foo"
  // Stops at "[" to mimic existing fixture naming convention.
  const m = promptText.match(/(?:^|\s)tc=([^[]+)/);
  if (!m) return null;
  return m[1].trim().split(/\s+/)[0] || null;
}

/**
 * Create SSE event string
 */
function createSSEEvent(eventType: string, data: any): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Create the Responses API handler
 */
export const createResponsesHandler =
  (prefix: string) => async (req: Request, res: Response) => {
    const { input, messages, stream = false } = req.body ?? {};
    console.log(`* [responses/${prefix}] Received request`, {
      hasInput: input != null,
      hasMessages: Array.isArray(messages),
      stream: Boolean(stream),
    });

    // Extract the last user message text (best-effort)
    const lastUserText =
      input != null
        ? extractTextFromInput(input)
        : extractTextFromMessages(messages);

    // Determine the response content
    let messageContent = CANNED_MESSAGE;

    // Check if the last message contains "[429]" to simulate rate limiting
    if (lastUserText.trim() === "[429]") {
      return res.status(429).json({
        error: {
          message: "Too many requests. Please try again later.",
          type: "rate_limit_error",
          param: null,
          code: "rate_limit_exceeded",
        },
      });
    }

    // Load a fixture file when the prompt includes tc=<name>
    const testCaseName = extractTestCaseName(lastUserText);
    if (testCaseName && !testCaseName.startsWith("local-agent/")) {
      const testFilePath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "e2e-tests",
        "fixtures",
        prefix,
        `${testCaseName}.md`,
      );
      try {
        messageContent = fs.readFileSync(testFilePath, "utf-8");
      } catch (error) {
        console.error(`* [responses/${prefix}] Error reading test file`, error);
        messageContent = `Error: Could not read test file: ${testCaseName}`;
      }
    }

    // Check if the message contains "[dump]" to generate a dump
    if (lastUserText.includes("[dump]")) {
      messageContent = generateDump(req);
    }

    const responseId = `resp_${Date.now()}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const model = req.body?.model || "fake-model";

    const baseResponseFields = {
      id: responseId,
      object: "response" as const,
      created_at: createdAt,
      model,
      error: null,
      incomplete_details: null,
      instructions: req.body?.instructions ?? null,
      metadata: req.body?.metadata ?? null,
      parallel_tool_calls: req.body?.parallel_tool_calls ?? true,
      temperature: req.body?.temperature ?? null,
      tool_choice: req.body?.tool_choice ?? "auto",
      tools: req.body?.tools ?? [],
      top_p: req.body?.top_p ?? null,
    };

    const mkUsage = () => ({
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: Math.max(1, Math.ceil(messageContent.length / 4)),
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 10 + Math.max(1, Math.ceil(messageContent.length / 4)),
    });

    // Non-streaming response
    if (!stream) {
      const outputItem = {
        id: `msg_${Date.now()}`,
        type: "message" as const,
        role: "assistant" as const,
        status: "completed" as const,
        content: [
          {
            type: "output_text" as const,
            text: messageContent,
            annotations: [],
          },
        ],
      };
      return res.json({
        ...baseResponseFields,
        output_text: messageContent,
        output: [outputItem],
        status: "completed",
        usage: mkUsage(),
      });
    }

    // Streaming response using SSE
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let sequence = 0;
    const nextSeq = () => sequence++;

    const outputItemId = `msg_${Date.now()}`;
    const emptyTextPart = {
      type: "output_text" as const,
      text: "",
      annotations: [],
    };

    // 1. response.created
    res.write(
      createSSEEvent("response.created", {
        type: "response.created",
        sequence_number: nextSeq(),
        response: {
          ...baseResponseFields,
          output_text: "",
          output: [],
          status: "in_progress",
        },
      }),
    );

    // 2. response.output_item.added
    res.write(
      createSSEEvent("response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        sequence_number: nextSeq(),
        item: {
          id: outputItemId,
          type: "message",
          role: "assistant",
          status: "in_progress",
          content: [],
        },
      }),
    );

    // 3. response.content_part.added
    res.write(
      createSSEEvent("response.content_part.added", {
        type: "response.content_part.added",
        output_index: 0,
        item_id: outputItemId,
        content_index: 0,
        sequence_number: nextSeq(),
        part: emptyTextPart,
      }),
    );

    // 4. Stream the text content in chunks
    const chars = messageContent.split("");
    const batchSize = 32;

    for (let i = 0; i < chars.length; i += batchSize) {
      const batch = chars.slice(i, i + batchSize).join("");

      res.write(
        createSSEEvent("response.output_text.delta", {
          type: "response.output_text.delta",
          output_index: 0,
          content_index: 0,
          item_id: outputItemId,
          sequence_number: nextSeq(),
          delta: batch,
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // 5. response.output_text.done
    res.write(
      createSSEEvent("response.output_text.done", {
        type: "response.output_text.done",
        output_index: 0,
        content_index: 0,
        item_id: outputItemId,
        sequence_number: nextSeq(),
        text: messageContent,
      }),
    );

    // 6. response.content_part.done
    res.write(
      createSSEEvent("response.content_part.done", {
        type: "response.content_part.done",
        output_index: 0,
        content_index: 0,
        item_id: outputItemId,
        sequence_number: nextSeq(),
        part: {
          type: "output_text",
          text: messageContent,
          annotations: [],
        },
      }),
    );

    // 7. response.output_item.done
    res.write(
      createSSEEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        sequence_number: nextSeq(),
        item: {
          id: outputItemId,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: messageContent,
              annotations: [],
            },
          ],
        },
      }),
    );

    // 8. response.completed
    const completedOutputItem = {
      id: outputItemId,
      type: "message" as const,
      role: "assistant" as const,
      status: "completed" as const,
      content: [
        {
          type: "output_text" as const,
          text: messageContent,
          annotations: [],
        },
      ],
    };

    res.write(
      createSSEEvent("response.completed", {
        type: "response.completed",
        sequence_number: nextSeq(),
        response: {
          ...baseResponseFields,
          output_text: messageContent,
          output: [completedOutputItem],
          status: "completed",
          usage: mkUsage(),
        },
      }),
    );

    // Match the general OpenAI streaming convention.
    res.write("data: [DONE]\n\n");
    res.end();
  };
