import { db } from "../../db";
import { apps, chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import { getDyadAppPath } from "../../paths/paths";
import { CodebaseFile, extractCodebase } from "../../utils/codebase";
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
}

/**
 * Deduplicate by case-insensitive name: referenced apps are keyed by name
 * downstream (e.g., AgentContext.referencedApps Map), so two apps sharing a
 * name would silently collide. Keep the first match and warn.
 */
function dedupeAppsByName(
  candidates: (typeof apps.$inferSelect)[],
): (typeof apps.$inferSelect)[] {
  const dedupedApps: (typeof apps.$inferSelect)[] = [];
  const seenNames = new Set<string>();
  for (const app of candidates) {
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

  return dedupeAppsByName(mentionedApps);
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

export interface StickyReferencedApps {
  references: MentionedAppReference[];
  /** The set to persist on the chat row: prior references plus new mentions. */
  appIds: number[];
  /** False when `appIds` already matches what was stored, so the write can be skipped. */
  changed: boolean;
}

function sameIdSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bSet = new Set(b);
  return a.every((id) => bSet.has(id));
}

/**
 * Resolve the referenced apps for an agent-backed turn: the apps already
 * referenced earlier in this chat, plus any newly mentioned in this prompt.
 *
 * Paths are resolved fresh from the app rows every turn, so renames and moves
 * are picked up and deleted apps silently drop out of the persisted set. Build
 * mode does not use this — it injects full codebases and stays per-turn, so a
 * stale reference there would silently cost tokens on every subsequent turn.
 */
export async function resolveStickyReferencedApps({
  prompt,
  persistedAppIds,
  excludeCurrentAppId,
}: {
  prompt: string;
  persistedAppIds: number[];
  excludeCurrentAppId?: number;
}): Promise<StickyReferencedApps> {
  const hasNewMention = prompt.includes("@app:");
  if (!hasNewMention && persistedAppIds.length === 0) {
    return { references: [], appIds: [], changed: false };
  }

  const allApps = await db.query.apps.findMany();

  // Prior references first so the ordering the user built up is stable, then
  // whatever this prompt adds. Apps deleted since they were referenced simply
  // do not match here, which prunes them from the persisted set.
  const persistedIdSet = new Set(persistedAppIds);
  const appsById = new Map(allApps.map((app) => [app.id, app]));
  const candidates = persistedAppIds
    .map((id) => appsById.get(id))
    .filter(
      (app): app is typeof apps.$inferSelect =>
        app !== undefined && app.id !== excludeCurrentAppId,
    );

  if (hasNewMention) {
    const mentionedAppNames = parseKnownAppMentions(
      prompt,
      allApps.map((app) => app.name),
    );
    const mentionedApps = await resolveMentionedApps(
      mentionedAppNames,
      excludeCurrentAppId,
      allApps,
    );
    for (const app of mentionedApps) {
      if (!persistedIdSet.has(app.id)) {
        candidates.push(app);
      }
    }
  }

  const dedupedApps = dedupeAppsByName(candidates);
  const appIds = dedupedApps.map((app) => app.id);

  return {
    references: dedupedApps.map((app) => ({
      appName: app.name,
      appPath: getDyadAppPath(app.path),
    })),
    appIds,
    changed: !sameIdSet(appIds, persistedAppIds),
  };
}

/**
 * Read the sticky referenced-app ids stored on a chat, tolerating rows written
 * before the column existed or by an older shape.
 */
export function readStoredReferencedAppIds(
  stored: number[] | null | undefined,
): number[] {
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.filter(
    (id): id is number => typeof id === "number" && Number.isInteger(id),
  );
}

export async function persistReferencedAppIds(
  chatId: number,
  appIds: number[],
): Promise<void> {
  await db
    .update(chats)
    .set({ referencedAppIds: appIds })
    .where(eq(chats.id, chatId));
}

/**
 * Resolve stored referenced-app ids to `{ id, name }` pairs for display,
 * dropping ids whose app no longer exists.
 */
export async function getReferencedAppsForDisplay(
  storedAppIds: number[] | null | undefined,
): Promise<{ id: number; name: string }[]> {
  const appIds = readStoredReferencedAppIds(storedAppIds);
  if (appIds.length === 0) {
    return [];
  }

  const allApps = await db.query.apps.findMany({
    columns: { id: true, name: true },
  });
  const appsById = new Map(allApps.map((app) => [app.id, app]));

  return appIds
    .map((id) => appsById.get(id))
    .filter((app): app is { id: number; name: string } => app !== undefined);
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
