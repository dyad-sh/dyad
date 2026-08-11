import { eq } from "drizzle-orm";

import { db } from "../../db";
import { projects } from "../../db/schema";
import { readSettings } from "../../main/settings";

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
export async function activeProjectPrompt(): Promise<string> {
  const id = readSettings().activeProjectId;
  if (!id) return "";

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1);

  if (!project?.instructions?.trim()) return "";

  return [
    "",
    `## Project: ${project.name}`,
    "",
    "Standing instructions from the user for this project. Follow them unless",
    "the current message asks for something different.",
    "",
    project.instructions.trim(),
  ].join("\n");
}
