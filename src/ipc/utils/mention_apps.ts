import { db } from "../../db";
import { getDyadAppPath } from "../../paths/paths";
import { CodebaseFile, extractCodebase } from "../../utils/codebase";
import { validateChatContext } from "../utils/context_paths_utils";
import log from "electron-log";

const logger = log.scope("mention_apps");

export interface MentionedAppReference {
  appName: string;
  appPath: string;
}

export interface MentionedAppCodebaseEntry extends MentionedAppReference {
  codebaseInfo: string;
  files: CodebaseFile[];
}

async function resolveMentionedApps(
  mentionedAppNames: string[],
  excludeCurrentAppId?: number,
) {
  if (mentionedAppNames.length === 0) {
    return [];
  }

  const allApps = await db.query.apps.findMany();

  const mentionedApps = allApps.filter(
    (app) =>
      mentionedAppNames.some(
        (mentionName) => app.name.toLowerCase() === mentionName.toLowerCase(),
      ) && app.id !== excludeCurrentAppId,
  );

  // Deduplicate by case-insensitive name: referenced apps are keyed by name
  // downstream (e.g., AgentContext.referencedApps Map), so two apps sharing a
  // name would silently collide. Keep the first match and warn.
  const dedupedApps: typeof mentionedApps = [];
  const seenNames = new Set<string>();
  for (const app of mentionedApps) {
    const key = app.name.toLowerCase();
    if (seenNames.has(key)) {
      logger.warn(
        `Multiple apps share the name "${app.name}"; skipping duplicate (app id: ${app.id}). Rename apps to disambiguate references.`,
      );
      continue;
    }
    seenNames.add(key);
    dedupedApps.push(app);
  }

  return dedupedApps;
}

/**
 * Lightweight resolver for `@app:Name` mentions. Returns only name/path pairs
 * without reading any file contents — use this when the caller just needs
 * to expose referenced apps to on-demand tools (agent/ask/plan modes).
 */
export async function extractMentionedAppsReferences(
  mentionedAppNames: string[],
  excludeCurrentAppId?: number,
): Promise<MentionedAppReference[]> {
  const dedupedApps = await resolveMentionedApps(
    mentionedAppNames,
    excludeCurrentAppId,
  );
  return dedupedApps.map((app) => ({
    appName: app.name,
    appPath: getDyadAppPath(app.path),
  }));
}

// Helper function to extract codebases from mentioned apps
export async function extractMentionedAppsCodebases(
  mentionedAppNames: string[],
  excludeCurrentAppId?: number,
): Promise<MentionedAppCodebaseEntry[]> {
  const dedupedApps = await resolveMentionedApps(
    mentionedAppNames,
    excludeCurrentAppId,
  );

  const results: MentionedAppCodebaseEntry[] = [];

  for (const app of dedupedApps) {
    try {
      const appPath = getDyadAppPath(app.path);
      const chatContext = validateChatContext(app.chatContext);

      const { formattedOutput, files } = await extractCodebase({
        appPath,
        chatContext,
      });

      results.push({
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
