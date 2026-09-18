import fs from "node:fs";
import path from "node:path";
import { buildFrontmatter, parsePlanFile, validatePlanId } from "./planUtils";
import { ensureDyadGitignored } from "./gitignoreUtils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Shared current-draft selection for UI and acceptance. Immutable handoff
 * snapshots are references, not revisions of the editable plan. */
export async function loadPlanForChat(appPath: string, chatId: number) {
  const directory = planDirForAppPath(appPath);
  let files: string[];
  try {
    files = await fs.promises.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const parsed = await Promise.all(
    files
      .filter(
        (name) =>
          name.startsWith(`chat-${chatId}-`) &&
          name.endsWith(".md") &&
          !new RegExp(`^chat-${chatId}-plan-[a-f0-9]{64}\\.md$`).test(name),
      )
      .map(async (name) => {
        try {
          return {
            slug: name.slice(0, -3),
            ...parsePlanFile(
              await fs.promises.readFile(path.join(directory, name), "utf8"),
            ),
          };
        } catch {
          // Preserve the UI's legacy behavior: one unreadable old file must
          // not hide the other drafts. Acceptance uses this same selection.
          return null;
        }
      }),
  );
  return (
    parsed
      .filter((p) => p !== null)
      .sort(
        (a, b) =>
          (a.meta.updatedAt || a.meta.createdAt || "").localeCompare(
            b.meta.updatedAt || b.meta.createdAt || "",
          ) || a.slug.localeCompare(b.slug),
      )
      .at(-1) ?? null
  );
}

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
  const plan = await loadPlanForChat(params.appPath, params.chatId);
  if (!plan) throw new DyadError("Plan not found", DyadErrorKind.NotFound);
  const { meta, content } = plan;
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
  /** A handoff reads this immutable accepted version, never a moving draft. */
  immutableVersion?: string;
}): Promise<string> {
  const { appPath, chatId, title, summary, content, status } = params;
  const planDir = planDirForAppPath(appPath);
  await fs.promises.mkdir(planDir, { recursive: true });
  await ensureDyadGitignored(appPath);

  if (
    params.immutableVersion &&
    !/^[a-f0-9]{64}$/.test(params.immutableVersion)
  )
    throw new DyadError(
      "Invalid immutable plan version",
      DyadErrorKind.Validation,
    );
  const slug = params.immutableVersion
    ? `${planSlugForChat(chatId)}-${params.immutableVersion}`
    : planSlugForChat(chatId);
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
  if (params.immutableVersion) {
    try {
      await fs.promises.writeFile(filePath, frontmatter + content, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = parsePlanFile(
        await fs.promises.readFile(filePath, "utf8"),
      );
      if (
        existing.content !== content.trim() ||
        existing.meta.title !== title ||
        (existing.meta.summary ?? "") !== (summary ?? "")
      )
        throw new DyadError(
          "Immutable plan version conflicts with stored content",
          DyadErrorKind.Conflict,
        );
    }
  } else await fs.promises.writeFile(filePath, frontmatter + content, "utf-8");

  return slug;
}
