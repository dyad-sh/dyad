import { AppChatContext, AppChatContextSchema } from "@/lib/schemas";
import log from "electron-log";

const logger = log.scope("context_paths_utils");

export function validateChatContext(chatContext: unknown): AppChatContext {
  if (!chatContext) {
    return {
      contextPaths: [],
      smartContextAutoIncludes: [],
      excludePaths: [],
    };
  }

  try {
    // Validate that the contextPaths data matches the expected schema
    return AppChatContextSchema.parse(chatContext);
  } catch (error) {
    logger.warn("Invalid contextPaths data:", error);
    // Return empty array as fallback if validation fails
    return {
      contextPaths: [],
      smartContextAutoIncludes: [],
      excludePaths: [],
    };
  }
}
