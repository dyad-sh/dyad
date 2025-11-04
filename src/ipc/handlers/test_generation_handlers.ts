import { ipcMain } from "electron";
import { streamText } from "ai";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getModelClient } from "../utils/get_model_client";
import { readSettings } from "../../main/settings";
import { extractCodebase } from "../../utils/codebase";
import { getDyadAppPath } from "../../paths/paths";
import { TEST_GENERATION_PROMPT } from "../../prompts/test_generation_prompt";
import log from "electron-log";
import { processFullResponseActions } from "../processors/response_processor";
import { createLoggedHandler } from "./safe_handle";
import { getMaxTokens, getTemperature } from "../utils/token_utils";

const logger = log.scope("test_generation_handlers");
const handle = createLoggedHandler(logger);

export interface GenerateTestsParams {
  appId: number;
  chatId: number;
  filePaths?: string[]; // Optional: specific files to generate tests for
  testType?: "unit" | "component" | "integration" | "e2e" | "all";
}

/**
 * Generate tests for the specified files or entire codebase
 */
handle("generate-tests", async (event, params: GenerateTestsParams) => {
  const { appId, chatId, filePaths, testType = "all" } = params;

  logger.info("Generating tests for app", { appId, filePaths, testType });

  // Get app info
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error(`App with ID ${appId} not found`);
  }

  const appPath = getDyadAppPath(app.path);
  const settings = await readSettings();

  // Extract codebase or specific files
  const codebaseFiles = await extractCodebase({
    appPath,
    ...(filePaths && { includePaths: filePaths }),
  });

  // Construct context from files
  const filesContext = codebaseFiles
    .map((file) => {
      return `<file path="${file.path}">\n${file.content}\n</file>`;
    })
    .join("\n\n");

  // Build the prompt
  const testTypeInstruction =
    testType !== "all"
      ? `\n\nFocus on generating ${testType} tests only.`
      : "";

  const userMessage = `Please generate comprehensive tests for the following code.${testTypeInstruction}

## Codebase

${filesContext}

Generate test files using <dyad-write> tags. Follow the testing best practices outlined in your instructions.`;

  // Get model client
  const modelClient = getModelClient(settings);
  const maxTokens = getMaxTokens(settings);
  const temperature = getTemperature(settings);

  logger.info("Starting test generation stream");

  let fullResponse = "";

  const result = streamText({
    model: modelClient,
    system: TEST_GENERATION_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    maxTokens,
    temperature,
  });

  // Stream the response back to the renderer
  const encoder = new TextEncoder();

  try {
    for await (const chunk of result.textStream) {
      fullResponse += chunk;

      // Send chunk to renderer
      event.sender.send("test-generation-chunk", {
        chatId,
        chunk,
        fullResponse,
      });
    }

    logger.info("Test generation complete, processing actions");

    // Process the response to create test files
    await processFullResponseActions(fullResponse, chatId, {
      chatSummary: "Generated tests",
      messageId: Date.now(), // Use timestamp as message ID for test generation
      appId,
      appPath,
      settings,
    });

    // Send completion event
    event.sender.send("test-generation-complete", {
      chatId,
      fullResponse,
      success: true,
    });

    return {
      success: true,
      fullResponse,
    };
  } catch (error) {
    logger.error("Error generating tests:", error);

    event.sender.send("test-generation-error", {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
});

/**
 * Quick test generation for a single file
 */
handle(
  "generate-tests-for-file",
  async (event, params: { appId: number; filePath: string; chatId: number }) => {
    const { appId, filePath, chatId } = params;

    return handle.invoke("generate-tests", event, {
      appId,
      chatId,
      filePaths: [filePath],
      testType: "all",
    });
  },
);

export function registerTestGenerationHandlers() {
  logger.info("Test generation handlers registered");
}
