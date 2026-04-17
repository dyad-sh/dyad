/**
 * Agent Blueprint Generator
 *
 * Takes an AgentCreationIntent and produces a full AgentBlueprint — a complete
 * configuration ready to be reviewed by the user and then auto-provisioned.
 *
 * Two modes:
 * 1. Local generation: template-matching + keyword heuristics (fast, no LLM)
 * 2. LLM generation: sends structured prompt to OpenClaw CNS for richer output
 *
 * Part of the NLP Chat → Agent Creation pipeline.
 */

import type {
  AgentType,
  AgentConfig,
  CreateAgentRequest,
} from "@/types/agent_builder";
import type { AgentCreationIntent, LLMClassification } from "./agent_intent_parser";
import { buildClassificationPrompt, parseLLMClassification } from "./agent_intent_parser";
import { AGENT_TEMPLATES } from "@/constants/agent_templates";
import type { AgentUIConfig, GenerateAgentUIResult } from "@/types/agent_ui_types";
import { generateAgentUI, getRecommendedUIConfig } from "./agent_ui_generator";
import { getRecommendedTemplate, createConfigFromTemplate } from "@/constants/agent_ui_templates";

// =============================================================================
// TYPES
// =============================================================================

/** Complete agent blueprint ready for review / auto-setup */
export interface AgentBlueprint {
  /** Unique ID for tracking this blueprint through the wizard */
  blueprintId: string;
  /** Original user message that triggered the blueprint */
  originalMessage: string;
  /** Original parsed intent */
  intent: AgentCreationIntent;

  // --- Agent core ---
  name: string;
  description: string;
  type: AgentType;
  systemPrompt: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  config: AgentConfig;

  // --- Tools ---
  tools: BlueprintTool[];

  // --- Knowledge ---
  knowledgeSources: BlueprintKnowledgeSource[];

  // --- Triggers ---
  triggers: BlueprintTrigger[];

  // --- UI ---
  uiComponents: BlueprintUIComponent[];
  
  /** Generated UI configuration and components (enhanced) */
  generatedUI?: BlueprintGeneratedUI;

  // --- Workflow ---
  workflow: BlueprintWorkflow | null;

  // --- Deployment ---
  deployment: BlueprintDeployment;

  // --- Matched template (if any) ---
  matchedTemplateId?: string;
}

export interface BlueprintTool {
  catalogId: string;
  name: string;
  description: string;
  enabled: boolean;
  requiresApproval: boolean;
  config?: Record<string, unknown>;
}

export interface BlueprintKnowledgeSource {
  type: "documents" | "website" | "database" | "api" | "marketplace" | "custom";
  name: string;
  description: string;
  config?: Record<string, unknown>;
}

export interface BlueprintTrigger {
  type: "webhook" | "schedule" | "event" | "manual" | "message";
  name: string;
  description: string;
  config?: Record<string, unknown>;
}

export interface BlueprintUIComponent {
  componentType: "chat" | "form" | "dashboard" | "table" | "card" | "modal" | "sidebar" | "header" | "custom";
  name: string;
  description: string;
}

/** Enhanced UI configuration for generated agent interfaces */
export interface BlueprintGeneratedUI {
  /** The template ID used (if any) */
  templateId?: string;
  /** Full UI configuration */
  config: AgentUIConfig;
  /** Generated UI result with pages and components */
  generated: GenerateAgentUIResult;
}

export interface BlueprintWorkflow {
  name: string;
  description: string;
  steps: BlueprintWorkflowStep[];
}

export interface BlueprintWorkflowStep {
  name: string;
  type: "llm" | "tool" | "condition" | "transform" | "api" | "code";
  description: string;
  config?: Record<string, unknown>;
}

export interface BlueprintDeployment {
  target: "local" | "docker" | "vercel" | "aws" | "custom";
  autoStart: boolean;
}

// =============================================================================
// SYSTEM PROMPT TEMPLATES
// =============================================================================

const SYSTEM_PROMPT_TEMPLATES: Record<AgentType, string> = {
  chatbot: `You are a helpful and professional AI assistant. Your role is to:

1. Listen carefully to user questions and requests
2. Provide accurate, clear, and helpful responses
3. Ask clarifying questions when the request is ambiguous
4. Be friendly, patient, and professional
5. Admit when you don't know something rather than guessing

Remember to:
- Use clear, simple language
- Provide examples when helpful
- Stay on topic and focused
- Be respectful and inclusive`,

  task: `You are an efficient task execution agent. Your role is to:

1. Receive task descriptions and break them into steps
2. Execute each step methodically using available tools
3. Report progress and results clearly
4. Handle errors gracefully with retry logic
5. Provide a summary of completed work

Guidelines:
- Always confirm task understanding before executing
- Use the most efficient approach
- Log each step for transparency
- Report any issues immediately`,

  rag: `You are a knowledge-powered research assistant. Your role is to:

1. Search through your knowledge base to find relevant information
2. Synthesize information from multiple sources
3. Provide well-sourced, accurate answers
4. Clearly distinguish between what you know and what you don't
5. Suggest follow-up queries when appropriate

Guidelines:
- Always cite your sources
- If information is uncertain, say so
- Provide context for your answers
- Organize complex answers with headings and bullet points`,

  workflow: `You are a workflow orchestration agent. Your role is to:

1. Coordinate multi-step processes efficiently
2. Manage data flow between workflow stages
3. Handle conditional logic and branching
4. Monitor workflow progress and handle errors
5. Provide status updates and completion reports

Guidelines:
- Validate inputs before processing
- Handle each step's output as the next step's input
- Implement proper error handling at each stage
- Log all workflow events for debugging`,

  "multi-agent": `You are a multi-agent coordinator. Your role is to:

1. Decompose complex tasks into sub-tasks
2. Delegate sub-tasks to specialized sub-agents
3. Coordinate results from multiple agents
4. Merge and synthesize outputs
5. Handle conflicts between agent outputs

Guidelines:
- Assign tasks based on agent specializations
- Monitor all sub-agent progress
- Handle sub-agent failures gracefully
- Produce a unified final output`,
};

// =============================================================================
// DEFAULT CONFIGS
// =============================================================================

const DEFAULT_CONFIGS: Record<AgentType, AgentConfig> = {
  chatbot: {
    memory: { type: "buffer", maxMessages: 20 },
    retry: { maxRetries: 3, backoffMs: 1000 },
    rateLimit: { requestsPerMinute: 60 },
  },
  task: {
    memory: { type: "buffer", maxMessages: 10 },
    retry: { maxRetries: 5, backoffMs: 2000 },
    rateLimit: { requestsPerMinute: 30 },
  },
  rag: {
    memory: { type: "vector", maxMessages: 50 },
    retry: { maxRetries: 3, backoffMs: 1000 },
    rateLimit: { requestsPerMinute: 40 },
  },
  workflow: {
    memory: { type: "buffer", maxMessages: 30 },
    retry: { maxRetries: 5, backoffMs: 3000 },
    rateLimit: { requestsPerMinute: 20 },
  },
  "multi-agent": {
    memory: { type: "summary", maxMessages: 40 },
    retry: { maxRetries: 3, backoffMs: 2000 },
    rateLimit: { requestsPerMinute: 30 },
  },
};

// =============================================================================
// TOOL MAPPING
// =============================================================================

/** Map tool keywords from intent parser to catalog tool IDs */
const TOOL_KEYWORD_TO_CATALOG: Record<string, string> = {
  web_search: "google-search",
  web_scraper: "google-scrape-summarize",
  api_call: "advanced-knowledge-search",
  database_query: "advanced-knowledge-search",
  file_reader: "document-text-extractor",
  email_sender: "advanced-knowledge-search",
  code_executor: "advanced-knowledge-search",
  image_generator: "advanced-knowledge-search",
  calendar: "advanced-knowledge-search",
  data_analyzer: "advanced-knowledge-search",
  text_summarizer: "summarize-document",
  translator: "advanced-knowledge-search",
  sentiment_analyzer: "advanced-knowledge-search",
};

// =============================================================================
// BLUEPRINT GENERATION
// =============================================================================

/**
 * Generate a full AgentBlueprint from an AgentCreationIntent.
 * This is the local (non-LLM) path — uses templates and heuristics.
 */
export function generateBlueprintFromIntent(
  intent: AgentCreationIntent,
  originalMessage: string,
): AgentBlueprint {
  const blueprintId = `bp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Try to match a template
  const matchedTemplate = findBestTemplate(intent);

  // Build system prompt
  const basePrompt = matchedTemplate?.systemPrompt || SYSTEM_PROMPT_TEMPLATES[intent.suggestedType];
  const systemPrompt = customizeSystemPrompt(basePrompt, intent);

  // Build tools
  const tools = buildToolList(intent, matchedTemplate);

  // Build knowledge sources
  const knowledgeSources = buildKnowledgeSources(intent);

  // Build triggers
  const triggers = buildTriggers(intent);

  // Build UI components
  const uiComponents = buildUIComponents(intent);

  // Build workflow
  const workflow = intent.wantsWorkflow ? buildWorkflow(intent) : null;

  // Build generated UI (using new UI generator)
  const generatedUI = intent.wantsUI ? buildGeneratedUI(blueprintId, intent, tools, knowledgeSources) : undefined;

  return {
    blueprintId,
    originalMessage,
    intent,
    name: intent.suggestedName || "New Agent",
    description: intent.description || intent.purpose,
    type: intent.suggestedType,
    systemPrompt,
    modelId: "gpt-5-mini",
    temperature: intent.suggestedType === "task" ? 0.3 : 0.7,
    maxTokens: 4096,
    config: DEFAULT_CONFIGS[intent.suggestedType] || DEFAULT_CONFIGS.chatbot,
    tools,
    knowledgeSources,
    triggers,
    uiComponents,
    generatedUI,
    workflow,
    deployment: {
      target: "local",
      autoStart: false,
    },
    matchedTemplateId: matchedTemplate?.id,
  };
}

/**
 * Generate a blueprint using LLM classification for richer results
 */
export function generateBlueprintWithLLM(
  intent: AgentCreationIntent,
  llmClassification: LLMClassification,
  originalMessage: string,
): AgentBlueprint {
  // Start with the local blueprint
  const blueprint = generateBlueprintFromIntent(intent, originalMessage);

  // Enhance with LLM-derived information
  if (llmClassification.name) {
    blueprint.name = llmClassification.name;
  }
  if (llmClassification.description) {
    blueprint.description = llmClassification.description;
  }
  if (llmClassification.purpose) {
    // Append purpose context to system prompt
    blueprint.systemPrompt = `${blueprint.systemPrompt}\n\nSpecific Focus:\n${llmClassification.purpose}`;
  }

  // Add any LLM-suggested tools not already included
  for (const toolName of llmClassification.tools) {
    const catalogId = TOOL_KEYWORD_TO_CATALOG[toolName] || toolName;
    if (!blueprint.tools.some((t) => t.catalogId === catalogId)) {
      blueprint.tools.push({
        catalogId,
        name: toolName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: `Tool for ${toolName.replace(/_/g, " ")}`,
        enabled: true,
        requiresApproval: false,
      });
    }
  }

  // Add any LLM-suggested knowledge sources
  for (const source of llmClassification.knowledgeSources) {
    type KnowledgeType = BlueprintKnowledgeSource["type"];
    const sourceType = (
      ["documents", "website", "database", "api", "marketplace", "custom"].includes(source)
        ? source
        : "custom"
    ) as KnowledgeType;
    if (!blueprint.knowledgeSources.some((k) => k.type === sourceType)) {
      blueprint.knowledgeSources.push({
        type: sourceType,
        name: `${source} knowledge`,
        description: `Knowledge from ${source}`,
      });
    }
  }

  // Add LLM-suggested UI components
  for (const comp of llmClassification.uiComponents) {
    type UIType = BlueprintUIComponent["componentType"];
    const compType = (
      ["chat", "form", "dashboard", "table", "card", "modal", "sidebar", "header", "custom"].includes(comp)
        ? comp
        : "custom"
    ) as UIType;
    if (!blueprint.uiComponents.some((u) => u.componentType === compType)) {
      blueprint.uiComponents.push({
        componentType: compType,
        name: `${comp.charAt(0).toUpperCase() + comp.slice(1)} View`,
        description: `${comp} component for the agent`,
      });
    }
  }

  return blueprint;
}

/**
* Build the LLM prompt for full blueprint generation.
* This creates a richer, more detailed blueprint via CNS.
*/
export function buildBlueprintPrompt(intent: AgentCreationIntent): string {
  return `You are an expert AI agent architect. Based on the following user intent, generate a complete agent blueprint.

User Intent:
- Purpose: ${intent.purpose}
- Suggested Type: ${intent.suggestedType}
- Suggested Name: ${intent.suggestedName}
- Domains: ${intent.domains.join(", ") || "general"}
- Detected Tools: ${intent.suggestedTools.join(", ") || "none"}
- Knowledge Needs: ${intent.knowledgeNeeds.join(", ") || "none"}
- Wants UI: ${intent.wantsUI}
- Wants Workflow: ${intent.wantsWorkflow}

Respond ONLY with a valid JSON object matching this schema:
{
  "name": "Agent Name",
  "description": "2-3 sentence description",
  "type": "${intent.suggestedType}",
  "systemPrompt": "Complete system prompt (multi-paragraph)",
  "modelId": "gpt-5-mini",
  "temperature": 0.7,
  "maxTokens": 4096,
  "tools": [{"name": "tool_name", "description": "what it does", "requiresApproval": false}],
  "knowledgeSources": [{"type": "documents|website|database|api|marketplace|custom", "name": "source name", "description": "what it provides"}],
  "triggers": [{"type": "webhook|schedule|event|manual|message", "name": "trigger name", "description": "when it fires"}],
  "uiComponents": [{"componentType": "chat|form|dashboard|table|card", "name": "Component Name", "description": "what it shows"}],
  "workflow": ${intent.wantsWorkflow ? '{"name": "workflow name", "description": "what it does", "steps": [{"name": "step name", "type": "llm|tool|condition|transform", "description": "step description"}]}' : "null"}
}`;
}

/** Parse a blueprint JSON response from the LLM */
export function parseBlueprintResponse(
  response: string,
  intent: AgentCreationIntent,
  originalMessage: string,
): AgentBlueprint | null {
  try {
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonStr);
    const blueprintId = `bp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    return {
      blueprintId,
      originalMessage,
      intent,
      name: String(parsed.name || intent.suggestedName || "New Agent"),
      description: String(parsed.description || intent.description || ""),
      type: parsed.type || intent.suggestedType,
      systemPrompt: String(parsed.systemPrompt || SYSTEM_PROMPT_TEMPLATES[intent.suggestedType]),
      modelId: String(parsed.modelId || "gpt-5-mini"),
      temperature: typeof parsed.temperature === "number" ? parsed.temperature : 0.7,
      maxTokens: typeof parsed.maxTokens === "number" ? parsed.maxTokens : 4096,
      config: DEFAULT_CONFIGS[intent.suggestedType] || DEFAULT_CONFIGS.chatbot,
      tools: Array.isArray(parsed.tools)
        ? parsed.tools.map((t: any) => ({
            catalogId: t.catalogId || t.name || "",
            name: String(t.name || ""),
            description: String(t.description || ""),
            enabled: true,
            requiresApproval: Boolean(t.requiresApproval),
            config: t.config,
          }))
        : [],
      knowledgeSources: Array.isArray(parsed.knowledgeSources)
        ? parsed.knowledgeSources.map((k: any) => ({
            type: k.type || "custom",
            name: String(k.name || ""),
            description: String(k.description || ""),
            config: k.config,
          }))
        : [],
      triggers: Array.isArray(parsed.triggers)
        ? parsed.triggers.map((t: any) => ({
            type: t.type || "manual",
            name: String(t.name || ""),
            description: String(t.description || ""),
            config: t.config,
          }))
        : [],
      uiComponents: Array.isArray(parsed.uiComponents)
        ? parsed.uiComponents.map((u: any) => ({
            componentType: u.componentType || "custom",
            name: String(u.name || ""),
            description: String(u.description || ""),
          }))
        : [],
      workflow: parsed.workflow
        ? {
            name: String(parsed.workflow.name || ""),
            description: String(parsed.workflow.description || ""),
            steps: Array.isArray(parsed.workflow.steps)
              ? parsed.workflow.steps.map((s: any) => ({
                  name: String(s.name || ""),
                  type: s.type || "llm",
                  description: String(s.description || ""),
                  config: s.config,
                }))
              : [],
          }
        : null,
      deployment: {
        target: "local",
        autoStart: false,
      },
    };
  } catch {
    return null;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function findBestTemplate(
  intent: AgentCreationIntent,
): (typeof AGENT_TEMPLATES)[0] | null {
  // Score each template
  let bestTemplate: (typeof AGENT_TEMPLATES)[0] | null = null;
  let bestScore = 0;

  for (const template of AGENT_TEMPLATES) {
    let score = 0;

    // Type match
    if (template.type === intent.suggestedType) score += 3;

    // Check keyword overlap with template name/description
    const templateText = `${template.name} ${template.description}`.toLowerCase();
    for (const domain of intent.domains) {
      if (templateText.includes(domain)) score += 2;
    }
    for (const kw of intent.extractedKeywords) {
      if (templateText.includes(kw)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestTemplate = template;
    }
  }

  return bestScore >= 3 ? bestTemplate : null;
}

function customizeSystemPrompt(
  basePrompt: string,
  intent: AgentCreationIntent,
): string {
  let prompt = basePrompt;

  if (intent.purpose) {
    prompt += `\n\nPrimary Purpose:\n${intent.purpose}`;
  }

  if (intent.domains.length > 0) {
    prompt += `\n\nDomain Focus:\n- ${intent.domains.join("\n- ")}`;
  }

  return prompt;
}

function buildToolList(
  intent: AgentCreationIntent,
  template: (typeof AGENT_TEMPLATES)[0] | null,
): BlueprintTool[] {
  const tools: BlueprintTool[] = [];
  const addedIds = new Set<string>();

  // Add tools from template
  if (template?.tools) {
    for (const tool of template.tools) {
      const catalogId = tool.name ?? "";
      if (catalogId && !addedIds.has(catalogId)) {
        addedIds.add(catalogId);
        tools.push({
          catalogId,
          name: catalogId,
          description: tool.description ?? "",
          enabled: true,
          requiresApproval: (tool as any).requiresApproval ?? false,
        });
      }
    }
  }

  // Add tools from intent keywords
  for (const toolKeyword of intent.suggestedTools) {
    const catalogId = TOOL_KEYWORD_TO_CATALOG[toolKeyword] || toolKeyword;
    if (!addedIds.has(catalogId)) {
      addedIds.add(catalogId);
      tools.push({
        catalogId,
        name: toolKeyword.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: `Tool for ${toolKeyword.replace(/_/g, " ")}`,
        enabled: true,
        requiresApproval: false,
      });
    }
  }

  return tools;
}

function buildKnowledgeSources(
  intent: AgentCreationIntent,
): BlueprintKnowledgeSource[] {
  const sources: BlueprintKnowledgeSource[] = [];
  const addedTypes = new Set<string>();

  for (const need of intent.knowledgeNeeds) {
    type KnowledgeType = BlueprintKnowledgeSource["type"];
    const sourceType = (
      ["documents", "website", "database", "api", "marketplace", "custom"].includes(need)
        ? need
        : "custom"
    ) as KnowledgeType;

    if (!addedTypes.has(sourceType)) {
      addedTypes.add(sourceType);
      sources.push({
        type: sourceType,
        name: `${need.charAt(0).toUpperCase() + need.slice(1)} Knowledge`,
        description: `Knowledge sourced from ${need}`,
      });
    }
  }

  // RAG agents always need at least one knowledge source
  if (intent.suggestedType === "rag" && sources.length === 0) {
    sources.push({
      type: "documents",
      name: "Document Knowledge Base",
      description: "Upload documents for the agent to search and reference",
    });
  }

  return sources;
}

function buildTriggers(intent: AgentCreationIntent): BlueprintTrigger[] {
  const triggers: BlueprintTrigger[] = [];
  const addedTypes = new Set<string>();

  for (const triggerKeyword of intent.suggestedTriggers) {
    type TriggerType = BlueprintTrigger["type"];
    const triggerType = (
      ["webhook", "schedule", "event", "manual", "message"].includes(triggerKeyword)
        ? triggerKeyword
        : "manual"
    ) as TriggerType;

    if (!addedTypes.has(triggerType)) {
      addedTypes.add(triggerType);
      triggers.push({
        type: triggerType,
        name: `${triggerKeyword.charAt(0).toUpperCase() + triggerKeyword.slice(1)} Trigger`,
        description: `Triggered by ${triggerKeyword}`,
      });
    }
  }

  // Always add manual trigger as fallback
  if (!addedTypes.has("manual")) {
    triggers.push({
      type: "manual",
      name: "Manual Trigger",
      description: "Trigger the agent manually on demand",
    });
  }

  return triggers;
}

function buildUIComponents(
  intent: AgentCreationIntent,
): BlueprintUIComponent[] {
  const components: BlueprintUIComponent[] = [];
  const addedTypes = new Set<string>();

  // Add components from intent
  for (const comp of intent.suggestedUIComponents) {
    type UIType = BlueprintUIComponent["componentType"];
    const compType = (
      ["chat", "form", "dashboard", "table", "card", "modal", "sidebar", "header", "custom"].includes(comp)
        ? comp
        : "custom"
    ) as UIType;

    if (!addedTypes.has(compType)) {
      addedTypes.add(compType);
      components.push({
        componentType: compType,
        name: `${comp.charAt(0).toUpperCase() + comp.slice(1)} Interface`,
        description: `${comp} component for interacting with the agent`,
      });
    }
  }

  // Chatbots always get a chat interface
  if (intent.suggestedType === "chatbot" && !addedTypes.has("chat")) {
    components.push({
      componentType: "chat",
      name: "Chat Interface",
      description: "Primary chat interface for the agent",
    });
  }

  // Task agents get a dashboard
  if (intent.suggestedType === "task" && !addedTypes.has("dashboard")) {
    components.push({
      componentType: "dashboard",
      name: "Task Dashboard",
      description: "Dashboard showing task status and results",
    });
  }

  // If UI is wanted but no components specified, add a chat interface
  if (intent.wantsUI && components.length === 0) {
    components.push({
      componentType: "chat",
      name: "Chat Interface",
      description: "Primary chat interface for the agent",
    });
  }

  return components;
}

function buildWorkflow(intent: AgentCreationIntent): BlueprintWorkflow {
  const steps: BlueprintWorkflowStep[] = [];

  // Basic workflow: receive input → process → respond
  steps.push({
    name: "Receive Input",
    type: "transform",
    description: "Parse and validate incoming request",
  });

  // Add tool steps based on suggested tools
  for (const tool of intent.suggestedTools) {
    steps.push({
      name: `Execute ${tool.replace(/_/g, " ")}`,
      type: "tool",
      description: `Run the ${tool.replace(/_/g, " ")} tool`,
    });
  }

  // Add LLM processing step
  steps.push({
    name: "AI Processing",
    type: "llm",
    description: "Process the results with the AI model",
  });

  // Add output step
  steps.push({
    name: "Format Output",
    type: "transform",
    description: "Format and return the final response",
  });

  return {
    name: `${intent.suggestedName || "Agent"} Workflow`,
    description: `Automated workflow for ${intent.purpose || "processing requests"}`,
    steps,
  };
}

/**
 * Convert an AgentBlueprint to a CreateAgentRequest for the agent builder.
 */
export function blueprintToCreateRequest(blueprint: AgentBlueprint): CreateAgentRequest {
  return {
    name: blueprint.name,
    description: blueprint.description,
    type: blueprint.type,
    systemPrompt: blueprint.systemPrompt,
    modelId: blueprint.modelId,
    config: blueprint.config,
  };
}

// =============================================================================
// GENERATED UI BUILDER
// =============================================================================

/**
 * Build the generated UI configuration and components for an agent.
 * This uses the new agent UI generator to create a complete UI.
 */
function buildGeneratedUI(
  agentId: string,
  intent: AgentCreationIntent,
  tools: BlueprintTool[],
  knowledgeSources: BlueprintKnowledgeSource[],
): BlueprintGeneratedUI {
  // Get recommended template for this agent type
  const template = getRecommendedTemplate(intent.suggestedType);
  
  // Get recommended UI config based on agent capabilities
  const hasTools = tools.length > 0;
  const hasKnowledge = knowledgeSources.length > 0;
  const recommendedConfig = getRecommendedUIConfig(intent.suggestedType, hasTools, hasKnowledge);
  
  // Create config from template with recommended overrides
  const config = createConfigFromTemplate(template.id, {
    ...recommendedConfig,
    branding: {
      agentName: intent.suggestedName || "Agent",
      agentDescription: intent.description || intent.purpose,
    },
  });
  
  // Generate the full UI
  const generated = generateAgentUI({
    agentId,
    agentType: intent.suggestedType,
    config,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
    })),
    knowledgeSources: knowledgeSources.map((k) => ({
      id: k.name.toLowerCase().replace(/\s+/g, "-"),
      name: k.name,
      type: k.type,
    })),
  });
  
  return {
    templateId: template.id,
    config,
    generated,
  };
}

/**
 * Regenerate UI for an existing blueprint with custom configuration.
 */
export function regenerateBlueprintUI(
  blueprint: AgentBlueprint,
  customConfig?: Partial<AgentUIConfig>,
  templateId?: string,
): BlueprintGeneratedUI {
  // Use custom template or get recommended one
  const template = templateId 
    ? getRecommendedTemplate(blueprint.type) // Will be overridden by createConfigFromTemplate
    : getRecommendedTemplate(blueprint.type);
  
  // Build config
  const config = templateId
    ? createConfigFromTemplate(templateId, customConfig)
    : createConfigFromTemplate(template.id, customConfig);
  
  // Add branding
  config.branding = {
    ...config.branding,
    agentName: blueprint.name,
    agentDescription: blueprint.description,
  };
  
  // Generate UI
  const generated = generateAgentUI({
    agentId: blueprint.blueprintId,
    agentType: blueprint.type,
    config,
    tools: blueprint.tools.map((t) => ({
      name: t.name,
      description: t.description,
    })),
    knowledgeSources: blueprint.knowledgeSources.map((k) => ({
      id: k.name.toLowerCase().replace(/\s+/g, "-"),
      name: k.name,
      type: k.type,
    })),
  });
  
  return {
    templateId: templateId || template.id,
    config,
    generated,
  };
}
