import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import {
  DEFAULT_CODEBASE_EXTRACTION_LIMITS,
  type CodebaseFile,
  type CodebaseTruncation,
  extractCodebase,
} from "../../utils/codebase";
import { validateChatContext } from "../utils/context_paths_utils";
import log from "electron-log";
import { parseKnownAppMentions } from "@/shared/parse_mention_apps";

const logger = log.scope("mention_apps");

export interface MentionedAppReference {
  appName: string;
  appPath: string;
}

export interface MentionedAppCodebaseEntry extends MentionedAppReference {
  codebaseInfo: string;
  files: CodebaseFile[];
  truncation?: CodebaseTruncation;
}

async function resolveMentionedApps(
  mentionedAppNames: string[],
  excludeCurrentAppId?: number,
  allApps?: (typeof apps.$inferSelect)[],
) {
  if (mentionedAppNames.length === 0) {
    return [];
  }

  const appsToSearch = allApps ?? (await db.query.apps.findMany());

  const mentionedApps = appsToSearch.filter(
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

async function resolveMentionedAppsFromPrompt(
  prompt: string,
  excludeCurrentAppId?: number,
) {
  if (!prompt.includes("@app:")) {
    return [];
  }

  const allApps = await db.query.apps.findMany();
  const mentionedAppNames = parseKnownAppMentions(
    prompt,
    allApps.map((app) => app.name),
  );
  return resolveMentionedApps(mentionedAppNames, excludeCurrentAppId, allApps);
}

async function extractCodebasesForApps(
  dedupedApps: (typeof apps.$inferSelect)[],
): Promise<MentionedAppCodebaseEntry[]> {
  const results: MentionedAppCodebaseEntry[] = [];
  let remainingFiles = DEFAULT_CODEBASE_EXTRACTION_LIMITS.maxFiles;
  let remainingContentBytes = DEFAULT_CODEBASE_EXTRACTION_LIMITS.maxTotalBytes;

  for (const app of dedupedApps) {
    try {
      const appPath = getDyadAppPath(app.path);

      // With no file slots left, extraction cannot include anything. Preserve
      // an entry for the referenced app so downstream prompts can disclose
      // that it was skipped, without traversing and statting its whole tree.
      if (remainingFiles <= 0) {
        const reasons: CodebaseTruncation["reasons"] = ["file-count"];
        if (remainingContentBytes <= 0) {
          reasons.push("total-bytes");
        }
        results.push({
          appName: app.name,
          appPath,
          codebaseInfo: "",
          files: [],
          truncation: {
            totalFileCount: 0,
            includedFileCount: 0,
            omittedFileCount: 0,
            includedContentBytes: 0,
            maxFiles: remainingFiles,
            maxTotalBytes: remainingContentBytes,
            reasons,
            budgetExhaustedBeforeScan: true,
          },
        });
        logger.warn(
          `Skipped codebase extraction for mentioned app ${app.name}: shared file budget exhausted`,
        );
        continue;
      }

      const chatContext = validateChatContext(app.chatContext);

      const { formattedOutput, files, includedContentBytes, truncation } =
        await extractCodebase({
          appPath,
          chatContext,
          limits: {
            maxFiles: remainingFiles,
            maxTotalBytes: remainingContentBytes,
          },
        });

      remainingFiles = Math.max(0, remainingFiles - files.length);
      remainingContentBytes = Math.max(
        0,
        remainingContentBytes - includedContentBytes,
      );

      results.push({
        appName: app.name,
        appPath,
        codebaseInfo: formattedOutput,
        files,
        truncation,
      });

      logger.log(`Extracted codebase for mentioned app: ${app.name}`);
    } catch (error) {
      logger.error(`Error extracting codebase for app ${app.name}:`, error);
      // Continue with other apps even if one fails
    }
  }

  return results;
}

export async function extractMentionedAppsReferencesFromPrompt(
  prompt: string,
  excludeCurrentAppId?: number,
): Promise<MentionedAppReference[]> {
  const dedupedApps = await resolveMentionedAppsFromPrompt(
    prompt,
    excludeCurrentAppId,
  );
  return dedupedApps.map((app) => ({
    appName: app.name,
    appPath: getDyadAppPath(app.path),
  }));
}

export async function extractMentionedAppsCodebasesFromPrompt(
  prompt: string,
  excludeCurrentAppId?: number,
): Promise<MentionedAppCodebaseEntry[]> {
  const dedupedApps = await resolveMentionedAppsFromPrompt(
    prompt,
    excludeCurrentAppId,
  );

  return extractCodebasesForApps(dedupedApps);
}
