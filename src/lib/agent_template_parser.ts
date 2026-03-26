/**
 * Agent Markdown Template Parser
 *
 * Parses VS Code-style .agent.md templates into AgentBlueprint objects.
 * Supports YAML frontmatter with description, tools, model, and type fields.
 * The markdown body defines the system prompt, including approach, constraints,
 * and structured sections.
 *
 * Example template:
 * ```
 * ---
 * description: "A senior TypeScript developer"
 * tools: [read, edit, search, execute]
 * type: task
 * model: gpt-4o
 * temperature: 0.3
 * ---
 * You are a senior developer...
 *
 * ## Approach
 * 1. Read the error output...
 *
 * ## Constraints
 * - DO NOT use any casts
 * ```
 */

import type { AgentType, AgentConfig } from "@/types/agent_builder";
import type { AgentBlueprint, BlueprintTool, BlueprintDeployment } from "./agent_blueprint_generator";
import type { AgentCreationIntent } from "./agent_intent_parser";
import { v4 as uuidv4 } from "uuid";

// =============================================================================
// TYPES
// =============================================================================

export interface AgentTemplateFrontmatter {
  name?: string;
  description?: string;
  tools?: string[];
  type?: AgentType;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Restrict which subagents this agent can invoke */
  agents?: string[];
}

export interface ParsedAgentTemplate {
  frontmatter: AgentTemplateFrontmatter;
  systemPrompt: string;
  /** Extracted sections from the markdown body */
  sections: {
    approach?: string;
    constraints?: string[];
    commands?: Record<string, string>;
    architecture?: string;
  };
}

// =============================================================================
// TOOL CATALOG — maps short aliases to full tool definitions
// =============================================================================

const TOOL_ALIAS_MAP: Record<string, { name: string; description: string; catalogId: string }> = {
  read: { name: "Read Files", description: "Read file contents from the project", catalogId: "builtin:read" },
  edit: { name: "Edit Files", description: "Create and modify files in the project", catalogId: "builtin:edit" },
  search: { name: "Search", description: "Search files by name or content", catalogId: "builtin:search" },
  execute: { name: "Execute Commands", description: "Run shell commands in a terminal", catalogId: "builtin:execute" },
  agent: { name: "Invoke Agents", description: "Delegate tasks to other specialized agents", catalogId: "builtin:agent" },
  todo: { name: "Task Tracking", description: "Manage todo lists for multi-step work", catalogId: "builtin:todo" },
  web: { name: "Web Access", description: "Fetch URLs and search the web", catalogId: "builtin:web" },
  database: { name: "Database", description: "Query and modify the local SQLite database", catalogId: "builtin:database" },
};

// =============================================================================
// FRONTMATTER PARSER
// =============================================================================

/**
 * Extract YAML frontmatter from a markdown string.
 * Parses the block between opening and closing `---` markers.
 */
function parseFrontmatter(markdown: string): { frontmatter: AgentTemplateFrontmatter; body: string } {
  const trimmed = markdown.trim();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: trimmed };
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  const frontmatter: AgentTemplateFrontmatter = {};

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    switch (key) {
      case "name":
        frontmatter.name = value;
        break;
      case "description":
        frontmatter.description = value;
        break;
      case "type":
        if (["chatbot", "task", "multi-agent", "workflow", "rag"].includes(value)) {
          frontmatter.type = value as AgentType;
        }
        break;
      case "model":
        frontmatter.model = value;
        break;
      case "temperature":
        frontmatter.temperature = parseFloat(value);
        break;
      case "maxTokens":
      case "max-tokens":
        frontmatter.maxTokens = parseInt(value, 10);
        break;
      case "tools":
        frontmatter.tools = parseYamlArray(value);
        break;
      case "agents":
        frontmatter.agents = parseYamlArray(value);
        break;
    }
  }

  return { frontmatter, body };
}

/** Parse a YAML inline array like `[read, edit, search]` or a comma-separated string */
function parseYamlArray(value: string): string[] {
  // Handle [item1, item2] format
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Handle comma-separated format
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// =============================================================================
// BODY SECTION PARSER
// =============================================================================

interface ExtractedSections {
  approach?: string;
  constraints?: string[];
  commands?: Record<string, string>;
  architecture?: string;
}

function extractSections(body: string): ExtractedSections {
  const sections: ExtractedSections = {};
  const lines = body.split("\n");

  let currentSection: string | null = null;
  let sectionContent: string[] = [];

  const flushSection = () => {
    if (!currentSection) return;
    const content = sectionContent.join("\n").trim();
    const sectionKey = currentSection.toLowerCase();

    if (sectionKey.includes("approach") || sectionKey.includes("how")) {
      sections.approach = content;
    } else if (sectionKey.includes("constraint") || sectionKey.includes("rule") || sectionKey.includes("do not")) {
      sections.constraints = content
        .split("\n")
        .filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*"))
        .map((l) => l.replace(/^[\s\-*]+/, "").trim());
    } else if (sectionKey.includes("command") || sectionKey.includes("key command")) {
      sections.commands = {};
      for (const line of content.split("\n")) {
        const match = line.match(/^\s*[-*]\s*\*\*(.+?)\*\*\s*[:—–-]\s*`(.+?)`/);
        if (match) {
          sections.commands[match[1].trim()] = match[2].trim();
        }
      }
    } else if (sectionKey.includes("architecture") || sectionKey.includes("awareness")) {
      sections.architecture = content;
    }
  };

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      flushSection();
      currentSection = headerMatch[1];
      sectionContent = [];
    } else {
      sectionContent.push(line);
    }
  }
  flushSection();

  return sections;
}

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * Parse a `.agent.md` template string into a structured representation.
 */
export function parseAgentTemplate(markdown: string): ParsedAgentTemplate {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const sections = extractSections(body);

  return {
    frontmatter,
    systemPrompt: body,
    sections,
  };
}

/**
 * Convert a parsed agent template into an AgentBlueprint
 * that can be fed into the existing auto-setup pipeline.
 */
export function templateToBlueprint(template: ParsedAgentTemplate, originalMessage: string): AgentBlueprint {
  const fm = template.frontmatter;

  // Map tool aliases to BlueprintTool entries
  const tools: BlueprintTool[] = (fm.tools || [])
    .map((alias) => {
      const toolDef = TOOL_ALIAS_MAP[alias.toLowerCase()];
      if (!toolDef) {
        return {
          catalogId: `custom:${alias}`,
          name: alias,
          description: `Custom tool: ${alias}`,
          enabled: true,
          requiresApproval: false,
        };
      }
      return {
        catalogId: toolDef.catalogId,
        name: toolDef.name,
        description: toolDef.description,
        enabled: true,
        requiresApproval: false,
      };
    });

  const config: AgentConfig = {
    tools: {
      enabled: (fm.tools || []).map((t) => t.toLowerCase()),
      customTools: [],
      mcpServers: [],
    },
  };

  if (fm.agents) {
    config.custom = { allowedAgents: fm.agents };
  }

  const intentStub: AgentCreationIntent = {
    detected: true,
    confidence: 1.0,
    purpose: fm.description || "Custom agent from template",
    suggestedType: fm.type || "task",
    suggestedName: fm.name || "Custom Agent",
    description: fm.description || "",
    domains: [],
    suggestedTools: fm.tools || [],
    knowledgeNeeds: [],
    suggestedTriggers: [],
    wantsUI: false,
    suggestedUIComponents: [],
    wantsWorkflow: false,
    extractedKeywords: [],
  };

  const deployment: BlueprintDeployment = {
    target: "local",
    autoStart: false,
  };

  return {
    blueprintId: uuidv4(),
    originalMessage,
    intent: intentStub,
    name: fm.name || "Custom Agent",
    description: fm.description || "",
    type: fm.type || "task",
    systemPrompt: template.systemPrompt,
    modelId: fm.model || "",
    temperature: fm.temperature ?? 0.7,
    maxTokens: fm.maxTokens ?? 4096,
    config,
    tools,
    knowledgeSources: [],
    triggers: [],
    uiComponents: [],
    workflow: null,
    deployment,
  };
}

/**
 * Generate a `.agent.md` template string from an existing Agent object.
 * Useful for exporting agents in the markdown format.
 */
export function agentToTemplate(agent: {
  name: string;
  description?: string;
  type?: AgentType;
  systemPrompt?: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  config?: AgentConfig;
}): string {
  const lines: string[] = ["---"];

  lines.push(`name: "${agent.name}"`);
  if (agent.description) {
    lines.push(`description: "${agent.description}"`);
  }
  if (agent.type) {
    lines.push(`type: ${agent.type}`);
  }
  if (agent.config?.tools?.enabled?.length) {
    lines.push(`tools: [${agent.config.tools.enabled.join(", ")}]`);
  }
  if (agent.modelId) {
    lines.push(`model: ${agent.modelId}`);
  }
  if (agent.temperature != null) {
    lines.push(`temperature: ${agent.temperature}`);
  }
  if (agent.maxTokens != null) {
    lines.push(`maxTokens: ${agent.maxTokens}`);
  }

  lines.push("---");
  lines.push("");

  if (agent.systemPrompt) {
    lines.push(agent.systemPrompt);
  }

  return lines.join("\n");
}
