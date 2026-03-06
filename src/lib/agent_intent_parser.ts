/**
 * Agent Intent Parser
 *
 * Detects when a user's chat message expresses intent to create, configure,
 * or modify an AI agent. Uses keyword matching for fast detection and
 * structured LLM classification for full intent extraction.
 *
 * Part of the NLP Chat → Agent Creation pipeline.
 */

import type { AgentType } from "@/types/agent_builder";

// =============================================================================
// TYPES
// =============================================================================

/** Extracted intent from a user's natural language message */
export interface AgentCreationIntent {
  /** Whether the message expresses agent creation intent */
  detected: boolean;
  /** Confidence score 0-1 */
  confidence: number;
  /** What the user wants the agent to do */
  purpose: string;
  /** Suggested agent type based on the description */
  suggestedType: AgentType;
  /** Suggested agent name */
  suggestedName: string;
  /** Short description derived from the user's message */
  description: string;
  /** Keywords/domains extracted from the message */
  domains: string[];
  /** Tools the agent might need */
  suggestedTools: string[];
  /** Knowledge sources the agent would need */
  knowledgeNeeds: string[];
  /** Suggested triggers */
  suggestedTriggers: string[];
  /** Whether the user wants a UI for the agent */
  wantsUI: boolean;
  /** Suggested UI components */
  suggestedUIComponents: string[];
  /** Whether the user mentioned workflow/automation */
  wantsWorkflow: boolean;
  /** Raw extracted keywords for debugging */
  extractedKeywords: string[];
}

/** LLM-based classification result */
export interface LLMClassification {
  isAgentRequest: boolean;
  confidence: number;
  agentType: AgentType;
  name: string;
  purpose: string;
  description: string;
  tools: string[];
  knowledgeSources: string[];
  triggers: string[];
  uiComponents: string[];
  wantsWorkflow: boolean;
  domains: string[];
}

// =============================================================================
// KEYWORD PATTERNS
// =============================================================================

/** Primary intent phrases — strong signals for agent creation */
const PRIMARY_INTENT_PHRASES = [
  "create an agent",
  "create a agent",
  "build an agent",
  "build a agent",
  "build me an agent",
  "build me a agent",
  "make an agent",
  "make a agent",
  "make me an agent",
  "make me a agent",
  "create a bot",
  "build a bot",
  "build me a bot",
  "make a bot",
  "make me a bot",
  "create an assistant",
  "build an assistant",
  "build me an assistant",
  "make an assistant",
  "make me an assistant",
  "i need an agent",
  "i need a bot",
  "i need an assistant",
  "i want an agent",
  "i want a bot",
  "i want an assistant",
  "set up an agent",
  "setup an agent",
  "design an agent",
  "design a bot",
  "create a chatbot",
  "build a chatbot",
  "make a chatbot",
  "new agent",
  "new bot",
  "new assistant",
  "launch an agent",
  "deploy an agent",
  "spin up an agent",
  "create an ai agent",
  "build an ai agent",
  "make an ai agent",
  "create an ai assistant",
  "build an ai assistant",
  "create a multi-agent",
  "build a multi-agent",
  "create a workflow agent",
  "build an autonomous agent",
  "create an autonomous agent",
  "create a rag agent",
  "build a rag agent",
];

/** Secondary intent phrases — weaker signals, need additional context */
const SECONDARY_INTENT_PHRASES = [
  "help me automate",
  "automate this",
  "can you automate",
  "i want to automate",
  "handle incoming",
  "process requests",
  "respond to customers",
  "customer support",
  "data analysis",
  "scrape data",
  "monitor for",
  "watch for changes",
  "answer questions about",
  "help users with",
  "analyze documents",
  "summarize reports",
  "generate reports",
  "research assistant",
  "coding assistant",
  "writing assistant",
];

/** Agent type keyword mappings */
const TYPE_KEYWORDS: Record<AgentType, string[]> = {
  chatbot: [
    "chatbot", "chat bot", "conversational", "chat with",
    "talk to", "customer support", "helpdesk", "help desk",
    "faq", "question answering", "customer service",
    "support agent", "support bot",
  ],
  task: [
    "task", "execute", "perform", "automate task",
    "do this", "run this", "process this", "handle this",
    "scheduled", "cron", "periodic", "batch process",
  ],
  rag: [
    "rag", "knowledge base", "document search", "search documents",
    "answer from documents", "retrieval", "knowledge",
    "research", "analyze documents", "pdf", "documentation",
    "look up", "find information", "search through",
  ],
  workflow: [
    "workflow", "pipeline", "multi-step", "chain",
    "sequence", "orchestrate", "coordinate", "flow",
    "process flow", "automation flow", "n8n",
  ],
  "multi-agent": [
    "multi-agent", "multiple agents", "team of agents",
    "agent team", "coordinate agents", "agents working together",
    "swarm", "crew", "collaborative", "division of labor",
  ],
};

/** Tool keyword mappings */
const TOOL_KEYWORDS: Record<string, string[]> = {
  web_search: ["search the web", "web search", "google", "look up online", "internet"],
  web_scraper: ["scrape", "scraping", "crawl", "extract from website", "pull data from"],
  api_call: ["api", "rest api", "endpoint", "http request", "webhook"],
  database_query: ["database", "sql", "query data", "data lookup", "db"],
  file_reader: ["read files", "parse files", "file system", "documents", "pdf", "csv"],
  email_sender: ["send email", "email notification", "mail", "smtp"],
  code_executor: ["run code", "execute code", "python", "javascript", "script"],
  image_generator: ["generate image", "create image", "dall-e", "stable diffusion", "image"],
  calendar: ["calendar", "schedule", "appointment", "meeting", "booking"],
  slack_messenger: ["slack", "post to slack", "slack notification"],
  discord_bot: ["discord", "discord bot", "discord channel"],
  data_analyzer: ["analyze data", "data analysis", "statistics", "metrics", "chart"],
};

/** Knowledge source keyword mappings */
const KNOWLEDGE_KEYWORDS: Record<string, string[]> = {
  documents: ["documents", "docs", "documentation", "pdf", "word", "files"],
  website: ["website", "web pages", "url", "site", "links"],
  database: ["database", "db", "sql", "data store"],
  api: ["api", "external api", "rest", "graphql"],
  marketplace: ["marketplace", "buy", "purchase", "joy marketplace", "dataset"],
  custom: ["custom data", "my data", "proprietary", "internal"],
};

/** Trigger keyword mappings */
const TRIGGER_KEYWORDS: Record<string, string[]> = {
  webhook: ["webhook", "http trigger", "api trigger", "incoming request"],
  schedule: ["schedule", "cron", "every hour", "every day", "daily", "weekly", "hourly", "periodic"],
  event: ["event", "on change", "when", "trigger when", "watch for", "monitor"],
  manual: ["manual", "on demand", "when I ask", "when needed"],
  message: ["message", "chat message", "incoming message", "dm", "whatsapp", "telegram"],
};

/** UI component keyword mappings */
const UI_KEYWORDS: Record<string, string[]> = {
  chat: ["chat interface", "chat window", "chat ui", "messaging"],
  dashboard: ["dashboard", "overview", "metrics panel", "stats"],
  form: ["form", "input form", "data entry", "submission"],
  table: ["table", "data table", "list view", "grid"],
  card: ["card", "info card", "summary card"],
};

// =============================================================================
// FAST KEYWORD-BASED DETECTION
// =============================================================================

/**
 * Quick keyword-based check for agent creation intent.
 * Fast and deterministic — use this to decide whether to invoke the LLM.
 */
export function quickDetectAgentIntent(message: string): {
  detected: boolean;
  confidence: number;
  matchedPhrases: string[];
} {
  const lower = message.toLowerCase().trim();
  const matchedPhrases: string[] = [];

  // Check primary intent phrases
  for (const phrase of PRIMARY_INTENT_PHRASES) {
    if (lower.includes(phrase)) {
      matchedPhrases.push(phrase);
    }
  }

  if (matchedPhrases.length > 0) {
    return {
      detected: true,
      confidence: Math.min(0.95, 0.7 + matchedPhrases.length * 0.1),
      matchedPhrases,
    };
  }

  // Check secondary intent phrases (need at least 2 matches)
  for (const phrase of SECONDARY_INTENT_PHRASES) {
    if (lower.includes(phrase)) {
      matchedPhrases.push(phrase);
    }
  }

  if (matchedPhrases.length >= 2) {
    return {
      detected: true,
      confidence: Math.min(0.8, 0.4 + matchedPhrases.length * 0.1),
      matchedPhrases,
    };
  }

  return {
    detected: false,
    confidence: matchedPhrases.length > 0 ? 0.2 : 0,
    matchedPhrases,
  };
}

// =============================================================================
// KEYWORD EXTRACTION
// =============================================================================

/** Extract all relevant keywords and classify the intent locally */
export function extractIntentKeywords(message: string): {
  type: AgentType;
  tools: string[];
  knowledge: string[];
  triggers: string[];
  uiComponents: string[];
  wantsUI: boolean;
  wantsWorkflow: boolean;
  domains: string[];
  allKeywords: string[];
} {
  const lower = message.toLowerCase();
  const allKeywords: string[] = [];

  // Detect agent type
  let bestType: AgentType = "chatbot";
  let bestTypeScore = 0;
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        score++;
        allKeywords.push(kw);
      }
    }
    if (score > bestTypeScore) {
      bestTypeScore = score;
      bestType = type as AgentType;
    }
  }

  // Detect tools
  const tools: string[] = [];
  for (const [toolName, keywords] of Object.entries(TOOL_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        if (!tools.includes(toolName)) tools.push(toolName);
        allKeywords.push(kw);
      }
    }
  }

  // Detect knowledge sources
  const knowledge: string[] = [];
  for (const [source, keywords] of Object.entries(KNOWLEDGE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        if (!knowledge.includes(source)) knowledge.push(source);
        allKeywords.push(kw);
      }
    }
  }

  // Detect triggers
  const triggers: string[] = [];
  for (const [trigger, keywords] of Object.entries(TRIGGER_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        if (!triggers.includes(trigger)) triggers.push(trigger);
        allKeywords.push(kw);
      }
    }
  }

  // Detect UI needs
  const uiComponents: string[] = [];
  let wantsUI = false;
  for (const [component, keywords] of Object.entries(UI_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        if (!uiComponents.includes(component)) uiComponents.push(component);
        wantsUI = true;
        allKeywords.push(kw);
      }
    }
  }

  // Check for explicit UI mentions
  if (lower.includes("with a ui") || lower.includes("with ui") ||
      lower.includes("with an interface") || lower.includes("frontend") ||
      lower.includes("user interface")) {
    wantsUI = true;
  }

  // Check for workflow mentions
  const wantsWorkflow = lower.includes("workflow") || lower.includes("n8n") ||
    lower.includes("pipeline") || lower.includes("automation flow");

  // Extract domains from common patterns
  const domains: string[] = [];
  const domainPatterns = [
    /(?:for|about|regarding|related to|in the field of|in)\s+(\w[\w\s]{1,30})/gi,
  ];
  for (const pattern of domainPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(message)) !== null) {
      const domain = match[1].trim().toLowerCase();
      if (domain.length > 2 && domain.length < 30 && !domains.includes(domain)) {
        domains.push(domain);
      }
    }
  }

  return {
    type: bestType,
    tools: [...new Set(tools)],
    knowledge: [...new Set(knowledge)],
    triggers: [...new Set(triggers)],
    uiComponents: [...new Set(uiComponents)],
    wantsUI,
    wantsWorkflow,
    domains: [...new Set(domains)],
    allKeywords: [...new Set(allKeywords)],
  };
}

// =============================================================================
// LLM-BASED CLASSIFICATION PROMPT
// =============================================================================

/** Build the prompt for LLM-based intent classification */
export function buildClassificationPrompt(userMessage: string): string {
  return `You are an AI agent creation classifier. Analyze the user's message and extract their intent for creating an AI agent.

Respond ONLY with a valid JSON object (no markdown, no explanation). Use this exact schema:

{
  "isAgentRequest": boolean,
  "confidence": number (0-1),
  "agentType": "chatbot" | "task" | "rag" | "workflow" | "multi-agent",
  "name": "suggested agent name (short, descriptive)",
  "purpose": "what the agent should do (1 sentence)",
  "description": "fuller description of the agent (2-3 sentences)",
  "tools": ["tool_name_1", "tool_name_2"],
  "knowledgeSources": ["source type 1", "source type 2"],
  "triggers": ["trigger type 1"],
  "uiComponents": ["component type 1"],
  "wantsWorkflow": boolean,
  "domains": ["domain1", "domain2"]
}

Available tool names: web_search, web_scraper, api_call, database_query, file_reader, email_sender, code_executor, image_generator, calendar, slack_messenger, discord_bot, data_analyzer, text_summarizer, translator, sentiment_analyzer

Available trigger types: webhook, schedule, event, manual, message

Available UI component types: chat, dashboard, form, table, card, modal, sidebar

User message: "${userMessage.replace(/"/g, '\\"')}"`;
}

/** Parse the LLM classification response */
export function parseLLMClassification(response: string): LLMClassification | null {
  try {
    // Try to extract JSON from the response
    let jsonStr = response.trim();

    // Remove markdown code block if present
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonStr);

    return {
      isAgentRequest: Boolean(parsed.isAgentRequest),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      agentType: validateAgentType(parsed.agentType),
      name: String(parsed.name || "Unnamed Agent"),
      purpose: String(parsed.purpose || ""),
      description: String(parsed.description || ""),
      tools: Array.isArray(parsed.tools) ? parsed.tools.map(String) : [],
      knowledgeSources: Array.isArray(parsed.knowledgeSources) ? parsed.knowledgeSources.map(String) : [],
      triggers: Array.isArray(parsed.triggers) ? parsed.triggers.map(String) : [],
      uiComponents: Array.isArray(parsed.uiComponents) ? parsed.uiComponents.map(String) : [],
      wantsWorkflow: Boolean(parsed.wantsWorkflow),
      domains: Array.isArray(parsed.domains) ? parsed.domains.map(String) : [],
    };
  } catch {
    return null;
  }
}

function validateAgentType(type: string): AgentType {
  const valid: AgentType[] = ["chatbot", "task", "rag", "workflow", "multi-agent"];
  return valid.includes(type as AgentType) ? (type as AgentType) : "chatbot";
}

// =============================================================================
// MAIN DETECTION FUNCTION
// =============================================================================

/**
 * Full agent creation intent detection.
 * First runs quick keyword detection, then enriches with keyword extraction.
 * The caller can optionally pass an LLM classification for higher accuracy.
 */
export function detectAgentCreationIntent(
  message: string,
  llmClassification?: LLMClassification | null,
): AgentCreationIntent {
  // Step 1: Quick keyword detection
  const quick = quickDetectAgentIntent(message);

  // Step 2: Extract keywords
  const keywords = extractIntentKeywords(message);

  // If LLM classification is available and says no, respect it
  if (llmClassification && !llmClassification.isAgentRequest) {
    return {
      detected: false,
      confidence: Math.min(quick.confidence, llmClassification.confidence),
      purpose: "",
      suggestedType: "chatbot",
      suggestedName: "",
      description: "",
      domains: [],
      suggestedTools: [],
      knowledgeNeeds: [],
      suggestedTriggers: [],
      wantsUI: false,
      suggestedUIComponents: [],
      wantsWorkflow: false,
      extractedKeywords: keywords.allKeywords,
    };
  }

  // If LLM classification is available and positive, merge with keyword data
  if (llmClassification && llmClassification.isAgentRequest) {
    return {
      detected: true,
      confidence: Math.max(quick.confidence, llmClassification.confidence),
      purpose: llmClassification.purpose,
      suggestedType: llmClassification.agentType || keywords.type,
      suggestedName: llmClassification.name,
      description: llmClassification.description,
      domains: [...new Set([...llmClassification.domains, ...keywords.domains])],
      suggestedTools: [...new Set([...llmClassification.tools, ...keywords.tools])],
      knowledgeNeeds: [...new Set([...llmClassification.knowledgeSources, ...keywords.knowledge])],
      suggestedTriggers: [...new Set([...llmClassification.triggers, ...keywords.triggers])],
      wantsUI: keywords.wantsUI || llmClassification.uiComponents.length > 0,
      suggestedUIComponents: [...new Set([...llmClassification.uiComponents, ...keywords.uiComponents])],
      wantsWorkflow: keywords.wantsWorkflow || llmClassification.wantsWorkflow,
      extractedKeywords: keywords.allKeywords,
    };
  }

  // Keyword-only detection (no LLM)
  if (!quick.detected) {
    return {
      detected: false,
      confidence: quick.confidence,
      purpose: "",
      suggestedType: keywords.type,
      suggestedName: "",
      description: "",
      domains: keywords.domains,
      suggestedTools: keywords.tools,
      knowledgeNeeds: keywords.knowledge,
      suggestedTriggers: keywords.triggers,
      wantsUI: keywords.wantsUI,
      suggestedUIComponents: keywords.uiComponents,
      wantsWorkflow: keywords.wantsWorkflow,
      extractedKeywords: keywords.allKeywords,
    };
  }

  // Detected via keywords, build a basic purpose from the message
  const purpose = extractPurpose(message);
  const suggestedName = generateAgentName(message, keywords.type);

  return {
    detected: true,
    confidence: quick.confidence,
    purpose,
    suggestedType: keywords.type,
    suggestedName,
    description: purpose,
    domains: keywords.domains,
    suggestedTools: keywords.tools,
    knowledgeNeeds: keywords.knowledge,
    suggestedTriggers: keywords.triggers,
    wantsUI: keywords.wantsUI,
    suggestedUIComponents: keywords.uiComponents,
    wantsWorkflow: keywords.wantsWorkflow,
    extractedKeywords: keywords.allKeywords,
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/** Extract purpose from the user's message */
function extractPurpose(message: string): string {
  // Try common patterns
  const patterns = [
    /(?:create|build|make|design|set up|setup)\s+(?:an?|me an?|me a)\s+(?:ai\s+)?(?:agent|bot|assistant|chatbot)\s+(?:that|which|to|for)\s+(.+)/i,
    /(?:i need|i want)\s+(?:an?|a)\s+(?:ai\s+)?(?:agent|bot|assistant|chatbot)\s+(?:that|which|to|for)\s+(.+)/i,
    /(?:agent|bot|assistant|chatbot)\s+(?:that|which|to|for)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match?.[1]) {
      return match[1].replace(/[.!?]+$/, "").trim();
    }
  }

  // Fallback: use the message itself, trimmed
  return message.length > 200 ? `${message.substring(0, 200)}...` : message;
}

/** Generate a suggested agent name from the message */
function generateAgentName(message: string, type: AgentType): string {
  const lower = message.toLowerCase();

  // Try to find a descriptive noun phrase after common patterns
  const namePatterns = [
    /(?:create|build|make)\s+(?:an?|me an?)\s+(.{3,30}?)(?:\s+agent|\s+bot|\s+assistant)/i,
    /(?:agent|bot|assistant)\s+(?:for|called|named)\s+(.{3,30})/i,
  ];

  for (const pattern of namePatterns) {
    const match = pattern.exec(message);
    if (match?.[1]) {
      const name = match[1].trim().replace(/^(?:ai\s+)/i, "");
      // Capitalize first letter of each word
      return name.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }

  // Domain-based name
  if (lower.includes("customer") || lower.includes("support")) return "Customer Support Agent";
  if (lower.includes("data") || lower.includes("analysis")) return "Data Analysis Agent";
  if (lower.includes("research")) return "Research Agent";
  if (lower.includes("coding") || lower.includes("code")) return "Coding Assistant";
  if (lower.includes("writing") || lower.includes("content")) return "Content Writer Agent";
  if (lower.includes("sales")) return "Sales Agent";
  if (lower.includes("marketing")) return "Marketing Agent";

  // Type-based fallback
  const typeNames: Record<AgentType, string> = {
    chatbot: "Chat Assistant",
    task: "Task Agent",
    rag: "Knowledge Agent",
    workflow: "Workflow Agent",
    "multi-agent": "Multi-Agent Team",
  };

  return typeNames[type] || "New Agent";
}
