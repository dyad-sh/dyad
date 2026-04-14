import { db } from "../../db";
import { getDyadAppPath } from "../../paths/paths";
import { CodebaseFile, extractCodebase } from "../../utils/codebase";
import { validateChatContext } from "../utils/context_paths_utils";
import log from "electron-log";

const logger = log.scope("mention_apps");

export interface MentionedAppCodebaseEntry {
  appId: number;
  appName: string;
  appPath: string;
  codebaseInfo: string;
  files: CodebaseFile[];
}

// Helper function to extract codebases from mentioned apps
export async function extractMentionedAppsCodebases(
  mentionedAppNames: string[],
  excludeCurrentAppId?: number,
): Promise<MentionedAppCodebaseEntry[]> {
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

  const results: MentionedAppCodebaseEntry[] = [];

  for (const app of mentionedApps) {
    try {
      const appPath = getDyadAppPath(app.path);
      const chatContext = validateChatContext(app.chatContext);

      const { formattedOutput, files } = await extractCodebase({
        appPath,
        chatContext,
      });

      results.push({
        appId: app.id,
        appName: app.name,
        appPath,
        codebaseInfo: formattedOutput,
        files,
      });

      logger.log(`Extracted codebase for mentioned app: ${app.name}`);
    } catch (error) {
      logger.error(`Error extracting codebase for app ${app.name}:`, error);
      // Continue with other apps even if one fails
    }
  }

  return results;
}
