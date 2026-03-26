/**
 * Agent Creation Handlers
 *
 * IPC handlers for the NLP Chat → Agent Creation pipeline.
 * Handles intent detection, blueprint generation, and auto-setup orchestration.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import {
  quickDetectAgentIntent,
  extractIntentKeywords,
  detectAgentCreationIntent,
  buildClassificationPrompt,
  parseLLMClassification,
  type AgentCreationIntent,
  type LLMClassification,
} from "@/lib/agent_intent_parser";
import {
  generateBlueprintFromIntent,
  generateBlueprintWithLLM,
  buildBlueprintPrompt,
  parseBlueprintResponse,
  type AgentBlueprint,
} from "@/lib/agent_blueprint_generator";
import {
  parseAgentTemplate,
  templateToBlueprint,
  agentToTemplate,
} from "@/lib/agent_template_parser";
import { safeSend } from "../utils/safe_sender";

const logger = log.scope("agent_creation_handlers");

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

export function registerAgentCreationHandlers() {
  /**
   * Quick intent detection — fast keyword-based check.
   * Returns whether the message likely contains agent creation intent.
   */
  ipcMain.handle(
    "agent:intent:quick-detect",
    async (_event: IpcMainInvokeEvent, message: string) => {
      logger.info("Quick intent detection for message:", message.substring(0, 80));
      const result = quickDetectAgentIntent(message);
      return result;
    },
  );

  /**
   * Full intent detection — keyword + optional LLM classification.
   * Returns the complete AgentCreationIntent.
   */
  ipcMain.handle(
    "agent:intent:detect",
    async (
      _event: IpcMainInvokeEvent,
      args: { message: string; useLLM?: boolean },
    ) => {
      logger.info("Full intent detection for message:", args.message.substring(0, 80));

      let llmClassification: LLMClassification | null = null;

      if (args.useLLM) {
        try {
          // Try to use OpenClaw CNS for LLM classification
          const { getOpenClawCNS } = await import("@/lib/openclaw_cns");
          const cns = getOpenClawCNS();
          const classificationPrompt = buildClassificationPrompt(args.message);
          const response = await cns.chat(classificationPrompt, {
            systemPrompt: "You are a JSON-only classifier. Respond with valid JSON only.",
            preferLocal: true,
          });
          llmClassification = parseLLMClassification(response);
          logger.info("LLM classification result:", llmClassification?.isAgentRequest);
        } catch (err) {
          logger.warn("LLM classification failed, falling back to keyword-only:", err);
        }
      }

      const intent = detectAgentCreationIntent(args.message, llmClassification);
      return intent;
    },
  );

  /**
   * Generate a blueprint from an intent.
   * Can use local heuristics or LLM for richer output.
   */
  ipcMain.handle(
    "agent:blueprint:generate",
    async (
      _event: IpcMainInvokeEvent,
      args: {
        intent: AgentCreationIntent;
        originalMessage: string;
        useLLM?: boolean;
      },
    ) => {
      logger.info("Generating blueprint for:", args.intent.suggestedName);

      if (args.useLLM) {
        try {
          const { getOpenClawCNS } = await import("@/lib/openclaw_cns");
          const cns = getOpenClawCNS();

          // Try full LLM blueprint generation
          const blueprintPrompt = buildBlueprintPrompt(args.intent);
          const response = await cns.chat(blueprintPrompt, {
            systemPrompt: "You are an expert AI agent architect. Respond with valid JSON only.",
            preferLocal: false,
          });

          const llmBlueprint = parseBlueprintResponse(response, args.intent, args.originalMessage);
          if (llmBlueprint) {
            logger.info("LLM blueprint generated successfully");
            return llmBlueprint;
          }

          logger.warn("Failed to parse LLM blueprint, falling back to local generation");
        } catch (err) {
          logger.warn("LLM blueprint generation failed:", err);
        }
      }

      // Fallback: local generation
      const blueprint = generateBlueprintFromIntent(args.intent, args.originalMessage);
      logger.info("Local blueprint generated:", blueprint.name);
      return blueprint;
    },
  );

  /**
   * Full pipeline: detect intent + generate blueprint in one call.
   * This is what the chat stream handler calls internally.
   */
  ipcMain.handle(
    "agent:pipeline:detect-and-generate",
    async (
      _event: IpcMainInvokeEvent,
      args: { message: string; useLLM?: boolean },
    ) => {
      logger.info("Running full agent creation pipeline");

      // Step 1: Quick check
      const quickResult = quickDetectAgentIntent(args.message);
      if (!quickResult.detected) {
        return { detected: false, intent: null, blueprint: null };
      }

      // Step 2: Full intent detection
      let llmClassification: LLMClassification | null = null;
      if (args.useLLM) {
        try {
          const { getOpenClawCNS } = await import("@/lib/openclaw_cns");
          const cns = getOpenClawCNS();
          const classificationPrompt = buildClassificationPrompt(args.message);
          const response = await cns.chat(classificationPrompt, {
            systemPrompt: "You are a JSON-only classifier. Respond with valid JSON only.",
            preferLocal: true,
          });
          llmClassification = parseLLMClassification(response);
        } catch (err) {
          logger.warn("LLM classification failed:", err);
        }
      }

      const intent = detectAgentCreationIntent(args.message, llmClassification);
      if (!intent.detected) {
        return { detected: false, intent, blueprint: null };
      }

      // Step 3: Generate blueprint
      let blueprint: AgentBlueprint;
      if (llmClassification && llmClassification.isAgentRequest) {
        blueprint = generateBlueprintWithLLM(intent, llmClassification, args.message);
      } else {
        blueprint = generateBlueprintFromIntent(intent, args.message);
      }

      logger.info("Pipeline complete:", blueprint.name, blueprint.type);
      return { detected: true, intent, blueprint };
    },
  );

  /**
   * Parse an agent markdown template (.agent.md format) and return a blueprint.
   * Accepts the raw markdown string with YAML frontmatter + system prompt body.
   */
  ipcMain.handle(
    "agent:template:parse",
    async (_event: IpcMainInvokeEvent, args: { markdown: string; originalMessage?: string }) => {
      logger.info("Parsing agent template...");
      const parsed = parseAgentTemplate(args.markdown);
      const blueprint = templateToBlueprint(parsed, args.originalMessage || "Created from template");
      logger.info("Template parsed:", blueprint.name, blueprint.type);
      return { parsed, blueprint };
    },
  );

  /**
   * Export an existing agent as a .agent.md template string.
   */
  ipcMain.handle(
    "agent:template:export",
    async (_event: IpcMainInvokeEvent, args: { agentId: number }) => {
      const { db } = await import("@/db");
      const { agents: agentsTable } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");

      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, args.agentId))
        .limit(1);

      if (!agent) {
        throw new Error(`Agent not found: ${args.agentId}`);
      }

      const template = agentToTemplate({
        name: agent.name,
        description: agent.description ?? undefined,
        type: (agent.type as any) ?? undefined,
        systemPrompt: agent.systemPrompt ?? undefined,
        modelId: agent.modelId ?? undefined,
        temperature: agent.temperature ?? undefined,
        maxTokens: agent.maxTokens ?? undefined,
        config: agent.configJson ? (typeof agent.configJson === "string" ? JSON.parse(agent.configJson) : agent.configJson) : undefined,
      });

      return { template };
    },
  );
}

// =============================================================================
// HELPER: Inline detection for chat stream
// =============================================================================

/**
 * Check a user message for agent creation intent inline during chat streaming.
 * If detected, sends a `chat:agent-blueprint` event to the renderer.
 *
 * Supports two modes:
 * 1. Natural language intent detection (e.g. "create an agent that...")
 * 2. Direct .agent.md template pasting (message starts with "---")
 *
 * @returns true if intent was detected (caller can decide how to proceed)
 */
export async function checkAgentIntentInStream(
  sender: Electron.WebContents,
  chatId: number,
  userMessage: string,
): Promise<{ detected: boolean; blueprint?: AgentBlueprint }> {
  try {
    // --- Fast path: detect .agent.md template format ---
    const trimmed = userMessage.trim();
    if (trimmed.startsWith("---") && trimmed.indexOf("---", 3) > 3) {
      // Looks like YAML frontmatter — try parsing as a template
      const parsed = parseAgentTemplate(trimmed);
      if (parsed.frontmatter.name || parsed.frontmatter.description || parsed.systemPrompt.length > 20) {
        logger.info("Agent template detected in chat message");
        const blueprint = templateToBlueprint(parsed, userMessage);

        safeSend(sender, "chat:agent-blueprint", {
          chatId,
          blueprint,
          intent: blueprint.intent,
          fromTemplate: true,
        });

        return { detected: true, blueprint };
      }
    }

    // --- Standard path: keyword-based intent detection ---
    const quickResult = quickDetectAgentIntent(userMessage);
    if (!quickResult.detected) {
      return { detected: false };
    }

    logger.info("Agent creation intent detected in chat stream");

    // Run full intent detection (keyword-only for speed in streaming context)
    const intent = detectAgentCreationIntent(userMessage);
    if (!intent.detected) {
      return { detected: false };
    }

    // Generate blueprint locally (fast path)
    const blueprint = generateBlueprintFromIntent(intent, userMessage);

    // Notify the renderer
    safeSend(sender, "chat:agent-blueprint", {
      chatId,
      blueprint,
      intent,
    });

    return { detected: true, blueprint };
  } catch (err) {
    logger.error("Error checking agent intent in stream:", err);
    return { detected: false };
  }
}
