import { db } from "../../db";
import { getDyadAppPath } from "../../paths/paths";
import { CodebaseFile, extractCodebase } from "../../utils/codebase";
import { validateChatContext } from "../utils/context_paths_utils";
import log from "electron-log";

const logger = log.scope("mention_apps");

export interface MentionedAppResult {
  appName: string;
  codebaseInfo: string;
  files: CodebaseFile[];
  isContractProject: boolean;
  deploymentInfo?: {
    chain: string;
    address: string;
    network: string;
    deploymentData?: Record<string, any>;
    deployedAt?: Date;
  };
}

// Helper function to extract codebases from mentioned apps
export async function extractMentionedAppsCodebases(
  mentionedAppNames: string[],
  excludeCurrentAppId?: number,
): Promise<MentionedAppResult[]> {
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

  const results: MentionedAppResult[] = [];

  for (const app of mentionedApps) {
    try {
      const appPath = getDyadAppPath(app.path);
      const chatContext = validateChatContext(app.chatContext);

      const { formattedOutput, files } = await extractCodebase({
        appPath,
        chatContext,
      });

      const result: MentionedAppResult = {
        appName: app.name,
        codebaseInfo: formattedOutput,
        files,
        isContractProject: app.isContractProject || false,
      };

      // Add deployment info if this is a deployed contract project
      if (
        app.isContractProject &&
        app.deploymentChain &&
        app.deploymentAddress
      ) {
        result.deploymentInfo = {
          chain: app.deploymentChain,
          address: app.deploymentAddress,
          network: app.deploymentNetwork || "unknown",
          deploymentData: app.deploymentData || undefined,
          deployedAt: app.deployedAt || undefined,
        };
      }

      results.push(result);

      logger.log(`Extracted codebase for mentioned app: ${app.name}`);
    } catch (error) {
      logger.error(`Error extracting codebase for app ${app.name}:`, error);
      // Continue with other apps even if one fails
    }
  }

  return results;
}
