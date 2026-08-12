import fs from "node:fs";
import nodePath from "node:path";
import { eq } from "drizzle-orm";

import { db } from "../../db";
import { projects } from "../../db/schema";
import { readSettings } from "../../main/settings";
import { getUserDataPath } from "../../paths/paths";

/**
 * The active project's standing instructions, as a system prompt block.
 *
 * Empty string when there is no project, when it has been deleted, or when it
 * carries no instructions, so the caller can concatenate unconditionally.
 *
 * The instructions are wrapped and labelled rather than pasted in bare: the
 * model should treat them as the user's standing preferences, not as part of
 * the application's own rules, and a reader of the prompt should be able to
 * tell which is which.
 */
/** Text worth inlining; anything else is named but not read. */
const READABLE =
  /\.(md|markdown|txt|json|ya?ml|toml|csv|ts|tsx|js|jsx|py|rs|go|sql|sh|html|css)$/i;

/** Total characters of file content allowed into one prompt. */
const FILE_BUDGET = 24_000;
/** Per-file ceiling, so one large document cannot take the whole budget. */
const PER_FILE_BUDGET = 8_000;

/**
 * The project's reference material.
 *
 * Every file is named, so the model knows what exists even when it cannot read
 * it. Text files are inlined up to a budget, largest-context-first by being
 * listed in directory order, and each one that was truncated says so — a model
 * that cannot tell a whole document from its first page will answer as though
 * it read the whole thing.
 *
 * Binary and unreadable files are listed without content rather than skipped,
 * because "there is a PDF called Architecture.pdf that I cannot read" is more
 * useful than silence.
 */
function projectFilesPrompt(projectId: string): string {
  const root = nodePath.join(getUserDataPath(), "projects", projectId);
  if (!fs.existsSync(root)) return "";

  const named: string[] = [];
  const inlined: string[] = [];
  let spent = 0;

  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = nodePath.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(absolute, relative);
        continue;
      }

      named.push(relative);
      if (!READABLE.test(entry.name) || spent >= FILE_BUDGET) continue;

      try {
        const raw = fs.readFileSync(absolute, "utf-8");
        const room = Math.min(PER_FILE_BUDGET, FILE_BUDGET - spent);
        const body = raw.slice(0, room);
        spent += body.length;
        inlined.push(
          [
            `### ${relative}`,
            body,
            body.length < raw.length
              ? `\n[Truncated: showing ${body.length} of ${raw.length} characters.]`
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } catch {
        // Unreadable is still worth naming, which already happened above.
      }
    }
  };

  walk(root, "");
  if (named.length === 0) return "";

  return [
    "",
    "### Project files",
    "",
    "Reference material attached to this project:",
    ...named.map((name) => `- ${name}`),
    ...(inlined.length > 0
      ? ["", "Contents of the readable files follow.", "", ...inlined]
      : []),
  ].join("\n");
}

export async function activeProjectPrompt(
  conversationProjectId?: string | null,
): Promise<string> {
  // The conversation's own project wins. Settings are the fallback for a
  // conversation that started before projects existed, or a caller with no
  // conversation of its own.
  const id =
    conversationProjectId === undefined
      ? readSettings().activeProjectId
      : conversationProjectId;
  if (!id) return "";

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (!project) return "";

  const files = projectFilesPrompt(project.id);
  const instructions = project.instructions?.trim();
  // A project with neither is a name, and a heading for it would be noise.
  if (!instructions && !files) return "";

  return [
    "",
    `## Project: ${project.name}`,
    ...(instructions
      ? [
          "",
          "Standing instructions from the user for this project. Follow them",
          "unless the current message asks for something different.",
          "",
          instructions,
        ]
      : []),
    files,
  ].join("\n");
}
