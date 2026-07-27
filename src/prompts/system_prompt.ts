import path from "node:path";
import fs from "node:fs";
import log from "electron-log";
import {
  constructLocalAgentPrompt,
  DEFAULT_AI_RULES,
} from "./local_agent_prompt";
import { constructPlanModePrompt } from "./plan_mode_prompt";
import type { AppFrameworkType } from "@/lib/framework_constants";

const logger = log.scope("system_prompt");

export const constructSystemPrompt = ({
  aiRules,
  chatMode = "local-agent",
  themePrompt,
  readOnly,
  frameworkType,
  hasSupabaseProject,
  enableAppBlueprint,
  testingEnabled,
  restartAppToolAvailable,
  rebuildAppToolAvailable,
}: {
  aiRules: string | undefined;
  chatMode?: "ask" | "local-agent" | "plan";
  themePrompt?: string;
  readOnly?: boolean;
  frameworkType?: AppFrameworkType | null;
  hasSupabaseProject?: boolean;
  enableAppBlueprint?: boolean;
  testingEnabled?: boolean;
  restartAppToolAvailable?: boolean;
  rebuildAppToolAvailable?: boolean;
}) => {
  if (chatMode === "plan") {
    return constructPlanModePrompt(aiRules, themePrompt);
  }

  return constructLocalAgentPrompt(aiRules, themePrompt, {
    readOnly: readOnly || chatMode === "ask",
    frameworkType,
    hasSupabaseProject,
    enableAppBlueprint,
    testingEnabled,
    restartAppToolAvailable,
    rebuildAppToolAvailable,
  });
};

export const readAiRules = async (dyadAppPath: string) => {
  const aiRulesPath = path.join(dyadAppPath, "AI_RULES.md");
  try {
    return await fs.promises.readFile(aiRulesPath, "utf8");
  } catch (error) {
    logger.info(
      `Error reading AI_RULES.md, fallback to default AI rules: ${error}`,
    );
    return DEFAULT_AI_RULES;
  }
};
