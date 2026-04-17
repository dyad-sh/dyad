/**
 * Skill IPC Handlers
 *
 * Registers all skill:* IPC channels for the main process.
 * Pattern: throw-on-error, typed params.
 */

import { ipcMain } from "electron";
import type {
  CreateSkillParams,
  UpdateSkillParams,
  SkillSearchParams,
  ExecuteSkillParams,
  SkillGenerationRequest,
  AttachSkillParams,
  DetachSkillParams,
  SkillPublishRequest,
} from "@/types/skill_types";
import {
  createSkill,
  getSkill,
  listSkills,
  updateSkill,
  deleteSkill,
  matchSkill,
  executeSkill,
  generateSkill,
  analyzeAndCreateMissingSkills,
  attachSkillToAgent,
  detachSkillFromAgent,
  listSkillsForAgent,
  exportSkillsMarkdown,
  ensureBootstrapSkills,
  learnSkillFromMessage,
} from "@/lib/skill_engine";
import log from "electron-log";

const logger = log.scope("skill-handlers");

export function registerSkillHandlers(): void {
  logger.info("Registering skill handlers");

  // ── CRUD ──────────────────────────────────────────────────────

  ipcMain.handle("skill:create", async (_, params: CreateSkillParams) => {
    return createSkill(params);
  });

  ipcMain.handle("skill:get", async (_, id: number) => {
    return getSkill(id);
  });

  ipcMain.handle("skill:list", async (_, params?: SkillSearchParams) => {
    return listSkills(params);
  });

  ipcMain.handle("skill:update", async (_, params: UpdateSkillParams) => {
    return updateSkill(params);
  });

  ipcMain.handle("skill:delete", async (_, id: number) => {
    return deleteSkill(id);
  });

  // ── Search / Match ────────────────────────────────────────────

  ipcMain.handle(
    "skill:search",
    async (_, params: SkillSearchParams) => {
      return listSkills(params);
    },
  );

  ipcMain.handle(
    "skill:match",
    async (_, text: string, agentId?: number) => {
      return matchSkill(text, agentId);
    },
  );

  // ── Execution ─────────────────────────────────────────────────

  ipcMain.handle("skill:execute", async (_, params: ExecuteSkillParams) => {
    return executeSkill(params);
  });

  // ── NLP Generation ────────────────────────────────────────────

  ipcMain.handle(
    "skill:generate",
    async (_, request: SkillGenerationRequest) => {
      return generateSkill(request);
    },
  );

  ipcMain.handle(
    "skill:auto-generate",
    async (
      _,
      params: {
        agentId: number;
        conversationHistory: Array<{ role: string; content: string }>;
      },
    ) => {
      return analyzeAndCreateMissingSkills(
        params.agentId,
        params.conversationHistory,
      );
    },
  );

  // ── Agent ↔ Skill Linking ─────────────────────────────────────

  ipcMain.handle(
    "skill:attach-to-agent",
    async (_, params: AttachSkillParams) => {
      return attachSkillToAgent(params);
    },
  );

  ipcMain.handle(
    "skill:detach-from-agent",
    async (_, params: DetachSkillParams) => {
      return detachSkillFromAgent(params);
    },
  );

  ipcMain.handle("skill:list-for-agent", async (_, agentId: number) => {
    return listSkillsForAgent(agentId);
  });

  // ── Marketplace Publish ───────────────────────────────────────

  ipcMain.handle(
    "skill:publish",
    async (_, params: SkillPublishRequest) => {
      // Mark for publishing — actual marketplace upload would call the marketplace API
      const { updateSkill: update } = await import("@/lib/skill_engine");
      return update({
        id: params.skillId,
        enabled: true,
      });
    },
  );

  ipcMain.handle("skill:unpublish", async (_, skillId: number) => {
    const { updateSkill: update } = await import("@/lib/skill_engine");
    return update({
      id: skillId,
    });
  });

  // ── Import / Export ───────────────────────────────────────────

  ipcMain.handle("skill:export", async (_, skillId: number) => {
    const skill = await getSkill(skillId);
    return JSON.stringify(skill, null, 2);
  });

  ipcMain.handle("skill:import", async (_, json: string) => {
    const data = JSON.parse(json);
    return createSkill({
      name: data.name,
      description: data.description,
      category: data.category,
      type: data.type,
      implementationType: data.implementationType,
      implementationCode: data.implementationCode,
      triggerPatterns: data.triggerPatterns,
      inputSchema: data.inputSchema,
      outputSchema: data.outputSchema,
      examples: data.examples,
      tags: data.tags,
    });
  });

  // ── Self-Learning / Bootstrap / Export MD ───────────────────

  ipcMain.handle("skill:export-md", async () => {
    return exportSkillsMarkdown();
  });

  ipcMain.handle("skill:bootstrap", async () => {
    return ensureBootstrapSkills();
  });

  ipcMain.handle(
    "skill:learn",
    async (
      _,
      params: { message: string; agentId?: number },
    ) => {
      return learnSkillFromMessage(params.message, params.agentId);
    },
  );
}
