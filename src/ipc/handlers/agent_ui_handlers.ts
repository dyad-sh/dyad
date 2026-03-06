/**
 * Agent UI Handlers
 *
 * IPC handlers for agent UI generation, preview, and export.
 * Part of the Agent UI Builder pipeline.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import type { AgentType } from "@/db/schema";
import type {
  AgentUIConfig,
  GenerateAgentUIRequest,
  GenerateAgentUIResult,
} from "@/types/agent_ui_types";
import {
  generateAgentUI,
  getRecommendedUIConfig,
  exportAgentUI,
} from "@/lib/agent_ui_generator";
import {
  AGENT_UI_TEMPLATES,
  UI_THEMES,
  getTemplatesForAgentType,
  getTemplateById,
  getRecommendedTemplate,
  getAvailableThemes,
  createConfigFromTemplate,
} from "@/constants/agent_ui_templates";

const logger = log.scope("agent_ui_handlers");

// =============================================================================
// TYPES
// =============================================================================

interface GenerateUIRequest {
  agentId: string;
  agentType: AgentType;
  templateId?: string;
  theme?: string;
  customConfig?: Partial<AgentUIConfig>;
  tools?: Array<{ id: string; name: string }>;
  knowledgeSources?: Array<{ id: string; name: string; type: string }>;
}

interface ExportUIRequest {
  generatedUI: GenerateAgentUIResult;
  format: "react" | "vue" | "html";
}

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

export function registerAgentUIHandlers() {
  /**
   * Get available UI templates for an agent type.
   */
  ipcMain.handle(
    "agent:ui:templates",
    async (_event: IpcMainInvokeEvent, agentType?: AgentType) => {
      logger.debug("Getting UI templates for:", agentType || "all");
      
      if (agentType) {
        return getTemplatesForAgentType(agentType);
      }
      return AGENT_UI_TEMPLATES;
    },
  );

  /**
   * Get available color themes.
   */
  ipcMain.handle(
    "agent:ui:themes",
    async (_event: IpcMainInvokeEvent) => {
      logger.debug("Getting available themes");
      return getAvailableThemes();
    },
  );

  /**
   * Get recommended UI configuration for an agent.
   */
  ipcMain.handle(
    "agent:ui:recommend-config",
    async (
      _event: IpcMainInvokeEvent,
      args: { agentType: AgentType; hasTools: boolean; hasKnowledge: boolean },
    ) => {
      logger.debug("Getting recommended config for:", args.agentType);
      return getRecommendedUIConfig(args.agentType, args.hasTools, args.hasKnowledge);
    },
  );

  /**
   * Generate agent UI based on configuration.
   * This is the main UI generation endpoint.
   */
  ipcMain.handle(
    "agent:ui:generate",
    async (_event: IpcMainInvokeEvent, request: GenerateUIRequest) => {
      logger.info("Generating UI for agent:", request.agentId);

      try {
        // Get base config from template or use defaults
        let config: AgentUIConfig;
        
        if (request.templateId) {
          const template = getTemplateById(request.templateId);
          if (template) {
            config = createConfigFromTemplate(request.templateId, request.customConfig);
          } else {
            logger.warn("Template not found:", request.templateId);
            const defaultTemplate = getRecommendedTemplate(request.agentType);
            config = createConfigFromTemplate(defaultTemplate.id, request.customConfig);
          }
        } else {
          // Use recommended template for this agent type
          const template = getRecommendedTemplate(request.agentType);
          config = createConfigFromTemplate(template.id, request.customConfig);
        }

        // Apply theme if specified
        if (request.theme && UI_THEMES[request.theme as keyof typeof UI_THEMES]) {
          config.customColors = UI_THEMES[request.theme as keyof typeof UI_THEMES];
        }

        // Build the generation request - map tools to correct format
        const genRequest: GenerateAgentUIRequest = {
          agentId: request.agentId,
          agentType: request.agentType,
          config,
          tools: request.tools?.map((t) => ({ name: t.name, description: t.name })),
          knowledgeSources: request.knowledgeSources?.map((k) => ({
            name: k.name,
            type: k.type,
            id: k.id,
          })),
        };

        // Generate the UI
        const result = generateAgentUI(genRequest);
        
        logger.info("UI generated:", result.appId, result.pages.length, "pages");
        return result;
      } catch (err) {
        logger.error("Failed to generate UI:", err);
        throw err;
      }
    },
  );

  /**
   * Export generated UI to code.
   */
  ipcMain.handle(
    "agent:ui:export",
    async (_event: IpcMainInvokeEvent, request: ExportUIRequest) => {
      logger.debug("Exporting UI to:", request.format);

      try {
        const code = exportAgentUI(request.generatedUI, request.format);
        return { code, format: request.format };
      } catch (err) {
        logger.error("Failed to export UI:", err);
        throw err;
      }
    },
  );

  /**
   * Preview a specific template without generating for an agent.
   */
  ipcMain.handle(
    "agent:ui:preview-template",
    async (_event: IpcMainInvokeEvent, templateId: string) => {
      logger.debug("Previewing template:", templateId);

      const template = getTemplateById(templateId);
      if (!template) {
        throw new Error(`Template not found: ${templateId}`);
      }

      // Generate a preview with placeholder data
      const config = createConfigFromTemplate(templateId, {
        branding: {
          agentName: "Preview Agent",
          agentDescription: "This is a preview of the template layout",
        },
      });

      const result = generateAgentUI({
        agentId: "preview-" + Date.now(),
        agentType: template.forAgentTypes[0] || "chatbot",
        config,
      });

      return {
        template,
        preview: result,
      };
    },
  );

  /**
   * Create config from template with custom overrides.
   */
  ipcMain.handle(
    "agent:ui:create-config",
    async (
      _event: IpcMainInvokeEvent,
      args: { templateId: string; overrides?: Partial<AgentUIConfig> },
    ) => {
      logger.debug("Creating config from template:", args.templateId);
      return createConfigFromTemplate(args.templateId, args.overrides);
    },
  );

  logger.info("Agent UI handlers registered");
}
