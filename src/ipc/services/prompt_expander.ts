import fs from "node:fs";
import * as path from "path";
import { readFile } from "fs/promises";
import { inArray } from "drizzle-orm";
import log from "electron-log";
import type { db as DbType } from "@/db";
import { prompts as promptsTable } from "@/db/schema";
import { replacePromptReference } from "../utils/replacePromptReference";
import { replaceSlashSkillReference } from "../utils/replaceSlashSkillReference";
import { parsePlanFile, validatePlanId } from "../handlers/planUtils";

const logger = log.scope("prompt_expander");

export interface SelectedComponent {
  name: string;
  relativePath: string;
  lineNumber: number;
}

/**
 * Expands user-prompt references into their full content before the prompt
 * is sent to the model (Phase 2 extraction from chat_stream_handlers.ts):
 *
 * - `@prompt:<id>` mentions -> stored prompt content
 * - `/slug` slash-skill references -> stored prompt content by slug
 * - `/implement-plan=<slug>` -> full plan implementation prompt
 * - selected component context snippets appended to the prompt
 *
 * All expansions are best-effort: failures are logged and leave the prompt
 * unchanged, matching the original inline behavior.
 */
export class PromptExpander {
  constructor(private readonly deps: { db: typeof DbType }) {}

  /** Inlines referenced prompt contents for mentions like `@prompt:<id>`. */
  async expandPromptReferences(userPrompt: string): Promise<string> {
    try {
      const matches = Array.from(userPrompt.matchAll(/@prompt:(\d+)/g));
      if (matches.length > 0) {
        const ids = Array.from(new Set(matches.map((m) => Number(m[1]))));
        const referenced = await this.deps.db
          .select()
          .from(promptsTable)
          .where(inArray(promptsTable.id, ids));
        if (referenced.length > 0) {
          const promptsMap: Record<number, string> = {};
          for (const p of referenced) {
            promptsMap[p.id] = p.content;
          }
          return replacePromptReference(userPrompt, promptsMap);
        }
      }
    } catch (e) {
      logger.error("Failed to inline referenced prompts:", e);
    }
    return userPrompt;
  }

  /** Expands `/slug` skill references (e.g. /webapp-testing) to prompt content. */
  expandSlashSkills(userPrompt: string): string {
    try {
      const slashSkillPattern = /(?:^|\s)\/([a-zA-Z0-9-]+)(?=\s|$)/;
      if (slashSkillPattern.test(userPrompt)) {
        const allPrompts = this.deps.db.select().from(promptsTable).all();
        const promptsBySlug: Record<string, string> = {};
        for (const p of allPrompts) {
          if (p.slug && !promptsBySlug[p.slug]) {
            promptsBySlug[p.slug] = p.content;
          }
        }
        return replaceSlashSkillReference(userPrompt, promptsBySlug);
      }
    } catch (e) {
      logger.error("Failed to expand slash skill references:", e);
    }
    return userPrompt;
  }

  /**
   * Expands `/implement-plan=<slug>` into the full implementation prompt.
   * Returns the expanded prompt plus the original short form (for display in
   * the UI), or the prompt unchanged when there is no match or expansion
   * fails.
   */
  async expandImplementPlan(
    userPrompt: string,
    appPath: string,
  ): Promise<{ userPrompt: string; displayPrompt?: string }> {
    const implementPlanMatch = userPrompt.match(/^\/implement-plan=(.+)$/);
    if (!implementPlanMatch) {
      return { userPrompt };
    }
    try {
      const displayPrompt = userPrompt;
      const planSlug = implementPlanMatch[1];
      validatePlanId(planSlug);
      const planFilePath = path.join(
        appPath,
        ".dyad",
        "plans",
        `${planSlug}.md`,
      );
      const raw = await fs.promises.readFile(planFilePath, "utf-8");
      const { meta, content } = parsePlanFile(raw);

      const planPath = `.dyad/plans/${planSlug}.md`;

      const expanded = `Please implement the following plan:

## ${meta.title || "Implementation Plan"}

${content}

Start implementing this plan now. Follow the steps outlined and create/modify the necessary files.
You may update the plan at \`${planPath}\` to mark your progress.`;
      return { userPrompt: expanded, displayPrompt };
    } catch (e) {
      logger.error("Failed to expand /implement-plan= prompt:", e);
      return { userPrompt };
    }
  }

  /** Appends context snippets for components the user selected in the preview. */
  async appendSelectedComponents(
    userPrompt: string,
    appPath: string,
    componentsToProcess: SelectedComponent[],
  ): Promise<string> {
    if (componentsToProcess.length === 0) {
      return userPrompt;
    }

    userPrompt += "\n\nSelected components:\n";

    for (const component of componentsToProcess) {
      let componentSnippet = "[component snippet not available]";
      try {
        const componentFileContent = await readFile(
          path.join(appPath, component.relativePath),
          "utf8",
        );
        const lines = componentFileContent.split(/\r?\n/);
        const selectedIndex = component.lineNumber - 1;

        // Let's get one line before and three after for context.
        const startIndex = Math.max(0, selectedIndex - 1);
        const endIndex = Math.min(lines.length, selectedIndex + 4);

        const snippetLines = lines.slice(startIndex, endIndex);
        const selectedLineInSnippetIndex = selectedIndex - startIndex;

        if (snippetLines[selectedLineInSnippetIndex]) {
          snippetLines[selectedLineInSnippetIndex] =
            `${snippetLines[selectedLineInSnippetIndex]} // <-- EDIT HERE`;
        }

        componentSnippet = snippetLines.join("\n");
      } catch (err) {
        logger.error(`Error reading selected component file content: ${err}`);
      }

      userPrompt += `\n${componentsToProcess.length > 1 ? `${componentsToProcess.indexOf(component) + 1}. ` : ""}Component: ${component.name} (file: ${component.relativePath})

Snippet:
\`\`\`
${componentSnippet}
\`\`\`
`;
    }

    return userPrompt;
  }
}
