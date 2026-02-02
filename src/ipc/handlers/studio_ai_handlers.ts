/**
 * Studio AI IPC Handlers
 * Registers IPC handlers for the unified Studio AI Service
 * 
 * Integrates Claude Code + Ollama across all studios:
 * - Data Studio
 * - Document Studio  
 * - Asset Studio
 * - Dataset Studio
 * - Agent Swarms
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import {
  getStudioAIService,
  initializeStudioAI,
  type StudioAIConfig,
  type StudioAIRequest,
  type StudioType,
} from "@/lib/studio_ai_service";

const logger = log.scope("studio_ai_handlers");

export function registerStudioAIHandlers(): void {
  const service = getStudioAIService();

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  ipcMain.handle(
    "studio-ai:initialize",
    async (_event: IpcMainInvokeEvent, config?: Partial<StudioAIConfig>) => {
      logger.info("Initializing Studio AI Service...");
      await initializeStudioAI(config);
      return { success: true };
    }
  );

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  ipcMain.handle("studio-ai:config:get", async () => {
    return service.getConfig();
  });

  ipcMain.handle(
    "studio-ai:config:update",
    async (_event: IpcMainInvokeEvent, updates: Partial<StudioAIConfig>) => {
      service.updateConfig(updates);
      return { success: true };
    }
  );

  ipcMain.handle("studio-ai:stats", async () => {
    return service.getStats();
  });

  // ===========================================================================
  // UNIFIED EXECUTE
  // ===========================================================================

  ipcMain.handle(
    "studio-ai:execute",
    async (
      _event: IpcMainInvokeEvent,
      request: {
        studio: StudioType;
        operation: string;
        prompt: string;
        systemPrompt?: string;
        context?: Record<string, unknown>;
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      const fullRequest: StudioAIRequest = {
        id: uuidv4(),
        studio: request.studio,
        operation: request.operation,
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        context: request.context,
        config: request.config,
        timestamp: Date.now(),
      };

      return service.execute(fullRequest);
    }
  );

  // ===========================================================================
  // DATA STUDIO
  // ===========================================================================

  ipcMain.handle(
    "studio-ai:data:generate-items",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        schema: Record<string, unknown>;
        count: number;
        examples?: unknown[];
        constraints?: string[];
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      return service.generateDatasetItems(params);
    }
  );

  ipcMain.handle(
    "studio-ai:data:augment",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        item: unknown;
        augmentationType: "paraphrase" | "expand" | "summarize" | "translate" | "noise";
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      return service.augmentData(params);
    }
  );

  ipcMain.handle(
    "studio-ai:data:analyze",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        data: unknown[];
        analysisType: "quality" | "distribution" | "anomalies" | "summary";
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      const prompt = `Analyze the following dataset (${params.data.length} items):

${JSON.stringify(params.data.slice(0, 10), null, 2)}${params.data.length > 10 ? "\n... (showing first 10 of " + params.data.length + " items)" : ""}

Analysis type: ${params.analysisType}

Provide a detailed analysis in JSON format with:
- summary: Overview of the data
- insights: Key findings
- issues: Any problems or inconsistencies
- recommendations: Suggestions for improvement`;

      return service.execute({
        id: uuidv4(),
        studio: "data-studio",
        operation: "analyze-data",
        prompt,
        config: params.config,
        timestamp: Date.now(),
      });
    }
  );

  // ===========================================================================
  // DOCUMENT STUDIO
  // ===========================================================================

  ipcMain.handle(
    "studio-ai:document:generate",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        type: "report" | "article" | "email" | "presentation" | "memo" | "proposal";
        description: string;
        tone?: string;
        length?: "short" | "medium" | "long";
        format?: "markdown" | "plain" | "html";
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      return service.generateDocument(params);
    }
  );

  ipcMain.handle(
    "studio-ai:document:enhance",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        content: string;
        enhancement: "grammar" | "style" | "clarity" | "expand" | "summarize";
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      const prompts: Record<string, string> = {
        grammar: "Fix grammar and spelling while preserving meaning:",
        style: "Improve the writing style while keeping the content:",
        clarity: "Rewrite for better clarity and readability:",
        expand: "Expand with more detail and examples:",
        summarize: "Create a concise summary of:",
      };

      return service.execute({
        id: uuidv4(),
        studio: "document-studio",
        operation: "enhance-document",
        prompt: `${prompts[params.enhancement]}\n\n${params.content}`,
        config: params.config,
        timestamp: Date.now(),
      });
    }
  );

  // ===========================================================================
  // ASSET STUDIO
  // ===========================================================================

  ipcMain.handle(
    "studio-ai:asset:generate-code",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        language: string;
        description: string;
        framework?: string;
        includeTests?: boolean;
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      return service.generateCode(params);
    }
  );

  ipcMain.handle(
    "studio-ai:asset:generate-schema",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        schemaType: "json-schema" | "openapi" | "graphql" | "sql" | "drizzle";
        description: string;
        entities?: string[];
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      return service.generateSchema(params);
    }
  );

  ipcMain.handle(
    "studio-ai:asset:analyze-code",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        code: string;
        language: string;
        analysisType: "bugs" | "security" | "performance" | "style" | "all";
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      const prompt = `Analyze the following ${params.language} code for ${params.analysisType === "all" ? "bugs, security issues, performance problems, and style" : params.analysisType}:

\`\`\`${params.language}
${params.code}
\`\`\`

Return a JSON object with:
- issues: Array of { type, severity, line, description, suggestion }
- score: Overall code quality score (0-100)
- summary: Brief overview of findings`;

      // Use Claude Code for code analysis
      return service.execute({
        id: uuidv4(),
        studio: "asset-studio",
        operation: "analyze-code",
        prompt,
        config: { ...params.config, useClaudeCode: true },
        timestamp: Date.now(),
      });
    }
  );

  ipcMain.handle(
    "studio-ai:asset:refactor-code",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        code: string;
        language: string;
        refactorType: "clean" | "optimize" | "modernize" | "typescript" | "functional";
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      const descriptions: Record<string, string> = {
        clean: "Clean up and improve readability",
        optimize: "Optimize for performance",
        modernize: "Update to modern syntax and patterns",
        typescript: "Convert to TypeScript with proper types",
        functional: "Refactor to functional programming style",
      };

      const prompt = `${descriptions[params.refactorType]} for the following ${params.language} code:

\`\`\`${params.language}
${params.code}
\`\`\`

Return ONLY the refactored code, no explanation.`;

      // Use Claude Code for refactoring
      return service.execute({
        id: uuidv4(),
        studio: "asset-studio",
        operation: "refactor-code",
        prompt,
        config: { ...params.config, useClaudeCode: true },
        timestamp: Date.now(),
      });
    }
  );

  ipcMain.handle(
    "studio-ai:asset:generate-tests",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        code: string;
        language: string;
        framework?: string;
        coverage?: "unit" | "integration" | "e2e" | "all";
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      const prompt = `Generate ${params.coverage || "unit"} tests for the following ${params.language} code${params.framework ? ` using ${params.framework}` : ""}:

\`\`\`${params.language}
${params.code}
\`\`\`

Include:
- Happy path tests
- Edge cases
- Error handling tests
- Type checking (if applicable)

Return complete, runnable test code.`;

      // Use Claude Code for test generation
      return service.execute({
        id: uuidv4(),
        studio: "asset-studio",
        operation: "generate-tests",
        prompt,
        config: { ...params.config, useClaudeCode: true },
        timestamp: Date.now(),
      });
    }
  );

  // ===========================================================================
  // AGENT SWARM
  // ===========================================================================

  ipcMain.handle(
    "studio-ai:swarm:generate-agent-config",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        role: string;
        capabilities: string[];
        objectives: string[];
        constraints?: string[];
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      return service.generateAgentConfig(params);
    }
  );

  ipcMain.handle(
    "studio-ai:swarm:execute-task",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        agentId: string;
        task: string;
        context?: Record<string, unknown>;
        systemPrompt?: string;
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      return service.executeAgentTask(params);
    }
  );

  ipcMain.handle(
    "studio-ai:swarm:coordinate",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        agents: Array<{ id: string; role: string; capabilities: string[] }>;
        objective: string;
        strategy?: "parallel" | "sequential" | "hierarchical";
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      return service.coordinateSwarm(params);
    }
  );

  ipcMain.handle(
    "studio-ai:swarm:optimize-agent",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        agentId: string;
        currentConfig: Record<string, unknown>;
        performanceMetrics: {
          successRate: number;
          avgLatency: number;
          tokenUsage: number;
          taskCompletion: number;
        };
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      const prompt = `Optimize the configuration for an AI agent based on performance metrics:

Current Config:
${JSON.stringify(params.currentConfig, null, 2)}

Performance Metrics:
- Success Rate: ${params.performanceMetrics.successRate}%
- Average Latency: ${params.performanceMetrics.avgLatency}ms
- Token Usage: ${params.performanceMetrics.tokenUsage}
- Task Completion: ${params.performanceMetrics.taskCompletion}%

Suggest optimizations to improve performance. Return a JSON object with:
- suggestedConfig: Updated configuration
- changes: Array of { setting, oldValue, newValue, reason }
- expectedImprovements: What improvements to expect`;

      return service.execute({
        id: uuidv4(),
        studio: "agent-swarm",
        operation: "optimize-agent",
        prompt,
        context: { agentId: params.agentId },
        config: params.config,
        timestamp: Date.now(),
      });
    }
  );

  // ===========================================================================
  // DATASET STUDIO (specific to dataset item generation)
  // ===========================================================================

  ipcMain.handle(
    "studio-ai:dataset:generate-qa-pairs",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        topic: string;
        count: number;
        difficulty?: "easy" | "medium" | "hard" | "mixed";
        format?: "simple" | "conversational" | "instructional";
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      const prompt = `Generate ${params.count} question-answer pairs about: ${params.topic}

Difficulty: ${params.difficulty || "mixed"}
Format: ${params.format || "simple"}

Return a JSON array where each item has:
- question: The question text
- answer: The answer text
- difficulty: easy/medium/hard
- category: Topic category

Ensure variety in question types (what, why, how, etc.)`;

      return service.execute({
        id: uuidv4(),
        studio: "dataset-studio",
        operation: "generate-qa",
        prompt,
        config: params.config,
        timestamp: Date.now(),
      });
    }
  );

  ipcMain.handle(
    "studio-ai:dataset:generate-conversations",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        scenario: string;
        turns: number;
        participants?: string[];
        tone?: string;
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      const prompt = `Generate a ${params.turns}-turn conversation:

Scenario: ${params.scenario}
Participants: ${params.participants?.join(", ") || "User and Assistant"}
Tone: ${params.tone || "helpful and professional"}

Return a JSON array of conversation turns:
[
  { "role": "user", "content": "..." },
  { "role": "assistant", "content": "..." },
  ...
]

Make the conversation natural and contextually appropriate.`;

      return service.execute({
        id: uuidv4(),
        studio: "dataset-studio",
        operation: "generate-conversation",
        prompt,
        config: params.config,
        timestamp: Date.now(),
      });
    }
  );

  ipcMain.handle(
    "studio-ai:dataset:generate-classification-data",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        categories: string[];
        count: number;
        domain?: string;
        includeEdgeCases?: boolean;
        config?: Partial<StudioAIConfig>;
      }
    ) => {
      const prompt = `Generate ${params.count} classification examples:

Categories: ${params.categories.join(", ")}
Domain: ${params.domain || "general"}
${params.includeEdgeCases ? "Include edge cases and ambiguous examples." : ""}

Return a JSON array where each item has:
- text: The text to classify
- label: The correct category
- confidence: How clear the classification is (0-1)

Ensure balanced distribution across categories.`;

      return service.execute({
        id: uuidv4(),
        studio: "dataset-studio",
        operation: "generate-classification",
        prompt,
        config: params.config,
        timestamp: Date.now(),
      });
    }
  );

  logger.info("Studio AI IPC handlers registered");
}
