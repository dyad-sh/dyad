import fs from "node:fs";
import path from "node:path";
import { buildFrontmatter, parsePlanFile, validatePlanId } from "./planUtils";
import { ensureDyadGitignored } from "./gitignoreUtils";

export type PlanStatus = "draft" | "accepted";

/**
 * A plan file is a `draft` while the user is still reviewing it and only
 * becomes `accepted` once they choose to implement it. Legacy plan files
 * (written before drafts were persisted) have no `status` field and are
 * treated as `accepted`, since they were only ever written on acceptance.
 */
export function normalizePlanStatus(raw: string | undefined): PlanStatus {
  // `admitting` was briefly written by pre-release builds. It was not durable
  // proof of chat-turn acceptance, so recover it as a retryable draft.
  return raw === "draft" || raw === "admitting" ? "draft" : "accepted";
}

export function planDirForAppPath(appPath: string): string {
  return path.join(appPath, ".dyad", "plans");
}

/**
 * Stable per-chat slug so repeated saves (draft revisions, then acceptance)
 * overwrite the same file instead of accumulating one file per keystroke/turn.
 */
export function planSlugForChat(chatId: number): string {
  const slug = `chat-${chatId}-plan`;
  validatePlanId(slug);
  return slug;
}

export async function readPlanFromDisk(params: {
  appPath: string;
  chatId: number;
}): Promise<{ title: string; summary?: string; content: string }> {
  const filePath = path.join(
    planDirForAppPath(params.appPath),
    `${planSlugForChat(params.chatId)}.md`,
  );
  const { meta, content } = parsePlanFile(
    await fs.promises.readFile(filePath, "utf-8"),
  );
  return {
    title: meta.title ?? "",
    ...(meta.summary ? { summary: meta.summary } : {}),
    content,
  };
}

/**
 * Upserts the plan file for a chat under `.dyad/plans/`. Returns the plan slug.
 *
 * Used when a plan is drafted and accepted. Preserves the original `createdAt`
 * when a file already exists so status promotion doesn't reset it.
 */
export async function savePlanToDisk(params: {
  appPath: string;
  chatId: number;
  title: string;
  summary?: string;
  content: string;
  status: PlanStatus;
}): Promise<string> {
  const { appPath, chatId, title, summary, content, status } = params;
  const planDir = planDirForAppPath(appPath);
  await fs.promises.mkdir(planDir, { recursive: true });
  await ensureDyadGitignored(appPath);

  const slug = planSlugForChat(chatId);
  const filePath = path.join(planDir, `${slug}.md`);
  const now = new Date().toISOString();

  // Preserve the original createdAt if we're overwriting an existing plan.
  let createdAt = now;
  try {
    const existing = await fs.promises.readFile(filePath, "utf-8");
    const { meta } = parsePlanFile(existing);
    if (meta.createdAt) createdAt = meta.createdAt;
  } catch {
    // No existing plan file — this is the first save.
  }

  const meta: Record<string, string> = {
    title,
    summary: summary ?? "",
    status,
    chatId: String(chatId),
    createdAt,
    updatedAt: now,
  };
  const frontmatter = buildFrontmatter(meta);
  await fs.promises.writeFile(filePath, frontmatter + content, "utf-8");

  return slug;
}
