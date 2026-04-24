/**
 * Skill → ToolDefinition Adapter
 *
 * Wraps every enabled skill from `skill_engine` as an agent-callable tool.
 * Naming: `skill_<skillId>_<sanitizedName>`.
 */

import { z } from "zod";
import log from "electron-log";
import { listSkills, executeSkill } from "@/lib/skill_engine";
import type { ToolDefinition } from "./types";

const logger = log.scope("skill_tools_adapter");

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
}

/**
 * Skills can change dynamically (created/edited at runtime), so this adapter
 * is *not* memoized — it re-reads the active skill list each call. Catalogs
 * are typically small (< 100 entries) so this is cheap.
 */
export async function getSkillAgentTools(): Promise<ToolDefinition[]> {
  let skills: Awaited<ReturnType<typeof listSkills>>;
  try {
    skills = await listSkills({ enabled: true, limit: 200 });
  } catch (err) {
    logger.warn(`Could not list skills: ${err}`);
    return [];
  }

  return skills.map((skill) => {
    const name = `skill_${skill.id}_${sanitize(skill.name)}`;
    return {
      name,
      description: skill.description ?? `Execute skill \"${skill.name}\"`,
      inputSchema: z.object({
        input: z.string().describe("Input text or instruction for the skill"),
        context: z.record(z.unknown()).optional(),
      }),
      defaultConsent: "ask",
      getConsentPreview: (args) =>
        `${name}(${(args.input ?? "").toString().slice(0, 60)})`,
      execute: async (args) => {
        const result = await executeSkill({
          skillId: skill.id,
          input: args.input,
          context: args.context,
        });
        if (!result.success) {
          throw new Error(result.error ?? "Skill execution failed");
        }
        return result.output;
      },
    } satisfies ToolDefinition;
  });
}

export async function getSkillAgentToolNames(): Promise<string[]> {
  return (await getSkillAgentTools()).map((t) => t.name);
}
