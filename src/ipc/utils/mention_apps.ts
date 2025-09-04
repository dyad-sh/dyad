import { db } from "../../db";
import { getDyadAppPath } from "../../paths/paths";
import { extractCodebase } from "../../utils/codebase";
import { validateChatContext } from "../utils/context_paths_utils";
import log from "electron-log";

const logger = log.scope("mention_apps");

// Helper function to extract codebases from mentioned apps
export async function extractMentionedAppsCodebases(
  mentionedAppNames: string[],
  excludeCurrentAppId?: number,
): Promise<{ appName: string; codebaseInfo: string }[]> {
  if (mentionedAppNames.length === 0) {
    return [];
  }

  // Get all apps
  const allApps = await db.query.apps.findMany();

  const mentionedApps = allApps.filter(
    (app) =>
      mentionedAppNames.some(
        (mentionName) => app.name.toLowerCase() === mentionName.toLowerCase(),
      ) && app.id !== excludeCurrentAppId,
  );

  const results: { appName: string; codebaseInfo: string }[] = [];

  for (const app of mentionedApps) {
    try {
      const appPath = getDyadAppPath(app.path);
      const chatContext = validateChatContext(app.chatContext);

      const { formattedOutput } = await extractCodebase({
        appPath,
        chatContext,
      });

      results.push({
        appName: app.name,
        codebaseInfo: formattedOutput,
      });

      logger.log(`Extracted codebase for mentioned app: ${app.name}`);
    } catch (error) {
      logger.error(`Error extracting codebase for app ${app.name}:`, error);
      // Continue with other apps even if one fails
    }
  }

  return results;
}
