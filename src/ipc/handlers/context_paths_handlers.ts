import { db } from "@/db";
import { apps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  AppChatContext,
  AppChatContextSchema,
  ContextPathResults,
} from "@/lib/schemas";
import { estimateTokens } from "../utils/token_utils";
import { createLoggedHandler } from "./safe_handle";
import log from "electron-log";
import { getDyadAppPath } from "@/paths/paths";
import { extractCodebase } from "@/utils/codebase";
import { validateChatContext } from "../utils/context_paths_utils";

const logger = log.scope("context_paths_handlers");
const handle = createLoggedHandler(logger);

export function registerContextPathsHandlers() {
  handle(
    "get-context-paths",
    async (_, { appId }: { appId: number }): Promise<ContextPathResults> => {
      z.object({ appId: z.number() }).parse({ appId });

      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      if (!app.path) {
        throw new Error("App path not set");
      }
      const appPath = getDyadAppPath(app.path);

      const results: ContextPathResults = {
        contextPaths: [],
        smartContextAutoIncludes: [],
        excludePaths: [],
      };
      const { contextPaths, smartContextAutoIncludes, excludePaths } =
        validateChatContext(app.chatContext);
      for (const contextPath of contextPaths) {
        const { formattedOutput, files } = await extractCodebase({
          appPath,
          chatContext: {
            contextPaths: [contextPath],
            smartContextAutoIncludes: [],
          },
        });
        const totalTokens = estimateTokens(formattedOutput);

        results.contextPaths.push({
          ...contextPath,
          files: files.length,
          tokens: totalTokens,
        });
      }

      for (const contextPath of smartContextAutoIncludes) {
        const { formattedOutput, files } = await extractCodebase({
          appPath,
          chatContext: {
            contextPaths: [contextPath],
            smartContextAutoIncludes: [],
          },
        });
        const totalTokens = estimateTokens(formattedOutput);

        results.smartContextAutoIncludes.push({
          ...contextPath,
          files: files.length,
          tokens: totalTokens,
        });
      }

      for (const excludePath of excludePaths || []) {
        const { formattedOutput, files } = await extractCodebase({
          appPath,
          chatContext: {
            contextPaths: [excludePath],
            smartContextAutoIncludes: [],
          },
        });
        const totalTokens = estimateTokens(formattedOutput);

        results.excludePaths.push({
          ...excludePath,
          files: files.length,
          tokens: totalTokens,
        });
      }
      return results;
    },
  );

  handle(
    "set-context-paths",
    async (
      _,
      { appId, chatContext }: { appId: number; chatContext: AppChatContext },
    ) => {
      const schema = z.object({
        appId: z.number(),
        chatContext: AppChatContextSchema,
      });
      schema.parse({ appId, chatContext });

      await db.update(apps).set({ chatContext }).where(eq(apps.id, appId));
    },
  );
}
