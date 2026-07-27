import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { CANNED_MESSAGE, createStreamChunk } from "./index";
import {
  handleLocalAgentFixture,
  extractLocalAgentFixture,
} from "./localAgentHandler";
import { fakeLlmLog } from "./log";
import { resolveDumpDir, resolveFixturesDir } from "./paths";

let globalCounter = 0;

function hasInvalidApiKey(req: Request): boolean {
  const authorization = req.headers.authorization;
  return typeof authorization === "string" && /invalid/i.test(authorization);
}

async function waitForDelayOrDisconnect(
  res: Response,
  delayMs: number,
): Promise<boolean> {
  let disconnected = false;
  await new Promise<void>((resolve) => {
    const onClose = () => {
      disconnected = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      res.removeListener("close", onClose);
      resolve();
    }, delayMs);
    res.once("close", onClose);
  });
  return disconnected;
}
export const createChatCompletionHandler =
  (prefix: string) => async (req: Request, res: Response) => {
    const { stream = false, messages = [] } = req.body;
    fakeLlmLog("* Received messages", messages);

    if (hasInvalidApiKey(req)) {
      return res.status(401).json({
        error: {
          message: "Invalid API key",
          type: "authentication_error",
          param: null,
          code: "invalid_api_key",
        },
      });
    }

    const lastMessage = messages[messages.length - 1];

    // Check for local-agent fixture requests (tc=local-agent/*)
    // We need to check ALL user messages, not just the last one, because
    // outer loop follow-up requests inject a todo reminder as the last user message.
    // The fixture trigger (tc=local-agent/...) will be in an earlier user message.
    const userMessages = messages.filter((m: any) => m.role === "user");

    // Helper to extract text content from a message (handles both string and array content)
    const getTextContent = (msg: any): string => {
      if (typeof msg.content === "string") {
        return msg.content;
      } else if (Array.isArray(msg.content)) {
        return msg.content
          .filter(
            (part: any) =>
              part.type === "text" && typeof part.text === "string",
          )
          .map((part: any) => part.text)
          .join("\n");
      }
      return "";
    };

    // Get the last user message's text content for other checks
    const lastUserMessage = userMessages[userMessages.length - 1];
    const userTextContent = lastUserMessage
      ? getTextContent(lastUserMessage)
      : "";
    // Check if the last user message contains "[429]" to simulate rate limiting.
    if (userTextContent === "[429]") {
      return res.status(429).json({
        error: {
          message: "Too many requests. Please try again later.",
          type: "rate_limit_error",
          param: null,
          code: "rate_limit_exceeded",
        },
      });
    }

    // First, check if the LAST user message is a fixture trigger
    let localAgentFixture = extractLocalAgentFixture(userTextContent);

    // If the last user message is synthetic (e.g., todo reminder or retry
    // continuation instruction), search earlier user messages for the original
    // fixture trigger.
    if (
      !localAgentFixture &&
      (userTextContent.includes("incomplete todo(s)") ||
        userTextContent.includes("previous response stream was interrupted") ||
        userTextContent.includes("did not finish completely"))
    ) {
      for (const msg of userMessages) {
        const textContent = getTextContent(msg);
        const fixture = extractLocalAgentFixture(textContent);
        if (fixture) {
          localAgentFixture = fixture;
          break; // Use the first (original) fixture trigger found
        }
      }
    }

    fakeLlmLog(
      `[local-agent] Checking message: "${userTextContent.slice(0, 50)}", fixture: ${localAgentFixture}`,
    );
    if (localAgentFixture) {
      return handleLocalAgentFixture(req, res, localAgentFixture);
    }

    if (userTextContent.startsWith("Generate an AI_RULES.md file")) {
      return handleLocalAgentFixture(req, res, "generate-ai-rules");
    }

    if (userTextContent.includes("attachment-only-setup-resume.txt")) {
      return handleLocalAgentFixture(req, res, "attachment-context-dump", {
        dumpRequest: () => generateDump(req),
        dumpRequestTurn: 1,
      });
    }

    // Route plan acceptance message to exit-plan fixture
    if (userTextContent.includes("I accept this plan")) {
      return handleLocalAgentFixture(req, res, "exit-plan");
    }

    if (
      /^Please fix the following(?: \d+)? security issues?\b/.test(
        userTextContent,
      )
    ) {
      return handleLocalAgentFixture(req, res, "basic-write");
    }
    if (
      userTextContent.startsWith("Please resolve the Git merge conflicts in")
    ) {
      return handleLocalAgentFixture(req, res, "resolve-merge-conflicts");
    }

    let messageContent = CANNED_MESSAGE;

    // Route plan comment messages to generate dump for testing
    if (userTextContent.includes("I have the following comments on the plan")) {
      messageContent =
        "I'll update the plan based on your comments.\n\n" + generateDump(req);
    }

    // Handle compaction summary requests (from generateText() in compaction_handler)
    if (
      userTextContent.startsWith("Please summarize the following conversation:")
    ) {
      messageContent =
        "## Key Decisions Made\n- Completed initial task as requested\n\n## Current Task State\nConversation was compacted to save context space.";
    }
    if (
      userTextContent.startsWith("Fix these 3 TypeScript compile-time error") &&
      userTextContent.includes("src/bad-file.tsx")
    ) {
      return handleLocalAgentFixture(req, res, "fix-tsx-errors-all", {
        dumpRequest: () => generateDump(req),
      });
    }
    if (
      userTextContent.startsWith("Fix these 2 TypeScript compile-time error")
    ) {
      const fixtureName = userTextContent.includes("src/bad-file.tsx")
        ? "fix-tsx-errors-selected"
        : "fix-ts-errors-two";
      return handleLocalAgentFixture(req, res, fixtureName, {
        dumpRequest: () => generateDump(req),
      });
    }
    if (
      userTextContent.startsWith("Fix these 1 TypeScript compile-time error")
    ) {
      return handleLocalAgentFixture(req, res, "fix-ts-errors-one", {
        dumpRequest: () => generateDump(req),
      });
    }
    if (userTextContent.startsWith("Fix error: Error Line 6 error")) {
      return handleLocalAgentFixture(req, res, "fix-runtime-error");
    }
    if (userTextContent.startsWith("Fix all of the following errors:")) {
      return handleLocalAgentFixture(req, res, "fix-multiple-errors");
    }
    const responseDelayMs = userTextContent.includes("[sleep=long]")
      ? 30_000
      : userTextContent.includes("[sleep=medium]")
        ? 10_000
        : 0;
    if (
      responseDelayMs > 0 &&
      (await waitForDelayOrDisconnect(res, responseDelayMs))
    ) {
      return;
    }

    if (
      lastMessage &&
      typeof lastMessage.content === "string" &&
      lastMessage.content.includes("TypeScript compile-time error")
    ) {
      messageContent += "\n\n" + generateDump(req);
    }
    fakeLlmLog("LASTMESSAGE", lastMessage);
    // Check if the last message is "[dump]" to write messages to file and return path
    if (
      lastMessage &&
      (Array.isArray(lastMessage.content)
        ? lastMessage.content.some(
            (part: { type: string; text: string }) =>
              part.type === "text" && part.text.includes("[dump]"),
          )
        : lastMessage.content.includes("[dump]"))
    ) {
      messageContent = generateDump(req);
    }

    if (userTextContent.startsWith("/security-review")) {
      messageContent = fs
        .readFileSync(
          path.join(resolveFixturesDir(), "security-review", "findings.md"),
          "utf-8",
        )
        .replace(/\r\n/g, "\n");
      messageContent += "\n\n" + generateDump(req);
    }

    if (
      userMessages.some(
        (message: any) => getTextContent(message) === "[increment]",
      )
    ) {
      globalCounter++;
      messageContent = `counter=${globalCounter}`;
    }

    // Check if the last message starts with "tc=" to load test case file
    if (
      userTextContent.startsWith("tc=") &&
      !userTextContent.startsWith("tc=local-agent/")
    ) {
      const testCaseName = userTextContent.slice(3).split("[")[0].trim(); // Remove "tc=" prefix
      fakeLlmLog(`* Loading test case: ${testCaseName}`);
      const testFilePath = path.join(
        resolveFixturesDir(),
        prefix,
        `${testCaseName}.md`,
      );

      try {
        if (fs.existsSync(testFilePath)) {
          messageContent = fs
            .readFileSync(testFilePath, "utf-8")
            .replace(/\r\n/g, "\n");
          fakeLlmLog(`* Loaded test case: `);
        } else {
          console.error(`* Test case file not found: ${testFilePath}`);
          messageContent = `Error: Test case file not found: ${testCaseName}.md`;
        }
      } catch (error) {
        console.error(`* Error reading test case file: ${error}`);
        messageContent = `Error: Could not read test case file: ${testCaseName}.md`;
      }
    }

    let message = {
      role: "assistant",
      content: messageContent,
    } as any;

    // Non-streaming response
    if (!stream) {
      return res.json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "fake-model",
        choices: [
          {
            index: 0,
            message,
            finish_reason: "stop",
          },
        ],
      });
    }

    // Streaming response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Check for high token usage marker to simulate near context limit
    const highTokensMatch =
      !userTextContent.startsWith("Summarize the following chat:") &&
      userTextContent.match(/\[high-tokens=(\d+)\]/);
    const highTokensValue = highTokensMatch
      ? parseInt(highTokensMatch[1], 10)
      : null;

    // Split the message into characters to simulate streaming
    const messageChars = messageContent.split("");

    // Stream each character with a delay
    let index = 0;
    const batchSize = 32;

    // Send role first
    res.write(createStreamChunk("", "assistant"));

    const interval = setInterval(() => {
      if (index < messageChars.length) {
        // Get the next batch of characters (up to batchSize)
        const batch = messageChars.slice(index, index + batchSize).join("");
        res.write(createStreamChunk(batch));
        index += batchSize;
      } else {
        // Send the final chunk with optional usage info for high token simulation
        const usage = highTokensValue
          ? {
              prompt_tokens: highTokensValue - 100,
              completion_tokens: 100,
              total_tokens: highTokensValue,
            }
          : undefined;
        res.write(createStreamChunk("", "assistant", true, usage));
        clearInterval(interval);
        res.end();
      }
    }, 10);
  };

export function generateDump(req: Request) {
  const timestamp = Date.now();
  // The vitest chat-flow harness points FAKE_LLM_DUMP_DIR at a unique temp dir
  // so concurrent test files never share the dump folder. The standalone CLI
  // (Playwright) falls back to the historical ./generated location.
  const generatedDir = resolveDumpDir();

  // Create generated directory if it doesn't exist
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  // Include a random suffix so parallel processes writing in the same
  // millisecond cannot collide on the dump filename.
  const dumpFilePath = path.join(
    generatedDir,
    `${timestamp}-${Math.random().toString(36).slice(2, 8)}.json`,
  );

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
    console.log(`* Dumped messages to: ${dumpFilePath}`);
    return `[[dyad-dump-path=${dumpFilePath}]]`;
  } catch (error) {
    console.error(`* Error writing dump file: ${error}`);
    return `Error: Could not write dump file: ${error}`;
  }
}
