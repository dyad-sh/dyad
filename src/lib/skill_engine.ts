/**
 * Skill Engine — core service for skill CRUD, trigger matching,
 * execution, NLP-powered skill generation, and autonomous self-learning.
 *
 * Runs in the main process; accessed by IPC handlers.
 */

import { eq, like, and, sql, desc, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { skills, agentSkillLinks } from "@/db/schema";
import type { SkillTriggerPattern } from "@/db/schema";
import type {
  Skill,
  SkillTriggerMatch,
  SkillExecutionContext,
  SkillExecutionResult,
  CreateSkillParams,
  UpdateSkillParams,
  SkillSearchParams,
  SkillGenerationRequest,
  SkillGenerationResult,
  AttachSkillParams,
  DetachSkillParams,
  ExecuteSkillParams,
} from "@/types/skill_types";
import { getOllamaApiUrl } from "@/ipc/handlers/local_model_ollama_handler";
import { app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";

const logger = log.scope("SkillEngine");

// =============================================================================
// CRUD
// =============================================================================

export async function createSkill(params: CreateSkillParams): Promise<Skill> {
  const db = getDb();
  const [row] = await db
    .insert(skills)
    .values({
      name: params.name,
      description: params.description,
      category: params.category,
      type: params.type ?? "custom",
      implementationType: params.implementationType,
      implementationCode: params.implementationCode ?? null,
      triggerPatterns: params.triggerPatterns ?? [],
      inputSchema: params.inputSchema ?? null,
      outputSchema: params.outputSchema ?? null,
      examples: params.examples ?? [],
      tags: params.tags ?? [],
    })
    .returning();
  return rowToSkill(row);
}

export async function getSkill(id: number): Promise<Skill> {
  const db = getDb();
  const row = await db.query.skills.findFirst({
    where: eq(skills.id, id),
  });
  if (!row) throw new Error(`Skill not found: ${id}`);
  return rowToSkill(row);
}

export async function listSkills(params?: SkillSearchParams): Promise<Skill[]> {
  const db = getDb();
  const conditions = [];

  if (params?.category) conditions.push(eq(skills.category, params.category));
  if (params?.type) conditions.push(eq(skills.type, params.type));
  if (params?.publishStatus) conditions.push(eq(skills.publishStatus, params.publishStatus));
  if (params?.enabled !== undefined) conditions.push(eq(skills.enabled, params.enabled));
  if (params?.query) conditions.push(like(skills.name, `%${params.query}%`));
  if (params?.tags?.length) {
    // match any tag overlap via JSON
    for (const tag of params.tags) {
      conditions.push(sql`json_each.value = ${tag}`);
    }
  }

  const query = db
    .select()
    .from(skills)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(skills.updatedAt))
    .limit(params?.limit ?? 100)
    .offset(params?.offset ?? 0);

  const rows = await query;
  return rows.map(rowToSkill);
}

export async function updateSkill(params: UpdateSkillParams): Promise<Skill> {
  const db = getDb();
  const updates: Record<string, unknown> = {};
  if (params.name !== undefined) updates.name = params.name;
  if (params.description !== undefined) updates.description = params.description;
  if (params.category !== undefined) updates.category = params.category;
  if (params.type !== undefined) updates.type = params.type;
  if (params.implementationType !== undefined) updates.implementationType = params.implementationType;
  if (params.implementationCode !== undefined) updates.implementationCode = params.implementationCode;
  if (params.triggerPatterns !== undefined) updates.triggerPatterns = params.triggerPatterns;
  if (params.inputSchema !== undefined) updates.inputSchema = params.inputSchema;
  if (params.outputSchema !== undefined) updates.outputSchema = params.outputSchema;
  if (params.examples !== undefined) updates.examples = params.examples;
  if (params.tags !== undefined) updates.tags = params.tags;
  if (params.enabled !== undefined) updates.enabled = params.enabled;
  if (params.version !== undefined) updates.version = params.version;
  updates.updatedAt = new Date();

  const [row] = await db
    .update(skills)
    .set(updates)
    .where(eq(skills.id, params.id))
    .returning();
  if (!row) throw new Error(`Skill not found: ${params.id}`);
  return rowToSkill(row);
}

export async function deleteSkill(id: number): Promise<void> {
  const db = getDb();
  const deleted = await db.delete(skills).where(eq(skills.id, id)).returning();
  if (!deleted.length) throw new Error(`Skill not found: ${id}`);
}

// =============================================================================
// AGENT ↔ SKILL LINKING
// =============================================================================

export async function attachSkillToAgent(params: AttachSkillParams): Promise<void> {
  const db = getDb();
  await db
    .insert(agentSkillLinks)
    .values({ agentId: params.agentId, skillId: params.skillId })
    .onConflictDoNothing();
}

export async function detachSkillFromAgent(params: DetachSkillParams): Promise<void> {
  const db = getDb();
  await db
    .delete(agentSkillLinks)
    .where(
      and(
        eq(agentSkillLinks.agentId, params.agentId),
        eq(agentSkillLinks.skillId, params.skillId),
      ),
    );
}

export async function listSkillsForAgent(agentId: number): Promise<Skill[]> {
  const db = getDb();
  const links = await db
    .select({ skillId: agentSkillLinks.skillId })
    .from(agentSkillLinks)
    .where(and(eq(agentSkillLinks.agentId, agentId), eq(agentSkillLinks.enabled, true)));

  if (!links.length) return [];

  const ids = links.map((l) => l.skillId);
  const rows = await db
    .select()
    .from(skills)
    .where(and(inArray(skills.id, ids), eq(skills.enabled, true)));
  return rows.map(rowToSkill);
}

// =============================================================================
// TRIGGER MATCHING — find the best skill for an incoming message
// =============================================================================

export async function matchSkill(text: string, agentId?: number): Promise<SkillTriggerMatch | null> {
  const allSkills = agentId ? await listSkillsForAgent(agentId) : await listSkills({ enabled: true });

  let bestMatch: SkillTriggerMatch | null = null;

  for (const skill of allSkills) {
    for (const trigger of skill.triggerPatterns) {
      const confidence = testTrigger(trigger, text);
      if (confidence > 0 && (!bestMatch || confidence > bestMatch.confidence)) {
        bestMatch = {
          skillId: skill.id,
          skill,
          confidence,
          matchedPattern: trigger,
          matchedText: text,
        };
      }
    }
  }

  return bestMatch;
}

function testTrigger(trigger: SkillTriggerPattern, text: string): number {
  const normalized = text.toLowerCase().trim();

  switch (trigger.type) {
    case "command": {
      // e.g. /summarize, /translate
      const cmd = trigger.pattern.toLowerCase();
      if (normalized.startsWith(cmd + " ") || normalized === cmd) {
        return 1.0;
      }
      return 0;
    }
    case "keyword": {
      const keywords = trigger.pattern.toLowerCase().split(",").map((k) => k.trim());
      const matchCount = keywords.filter((kw) => normalized.includes(kw)).length;
      return matchCount > 0 ? matchCount / keywords.length : 0;
    }
    case "regex": {
      try {
        const re = new RegExp(trigger.pattern, "i");
        return re.test(text) ? 0.9 : 0;
      } catch {
        return 0;
      }
    }
    case "event": {
      // Event-based triggers are matched externally
      return 0;
    }
    default:
      return 0;
  }
}

// =============================================================================
// EXECUTION — run a skill's implementation
// =============================================================================

export async function executeSkill(params: ExecuteSkillParams): Promise<SkillExecutionResult> {
  const start = Date.now();
  const skill = await getSkill(params.skillId);

  if (!skill.enabled) {
    throw new Error(`Skill "${skill.name}" is disabled`);
  }

  try {
    let output: string;

    switch (skill.implementationType) {
      case "prompt":
        output = await executePromptSkill(skill, params.input, params.context);
        break;
      case "function":
        output = await executeFunctionSkill(skill, params.input, params.context);
        break;
      case "tool":
        output = `[Tool skill "${skill.name}" — delegate to tool: ${skill.implementationCode}]`;
        break;
      case "workflow":
        output = `[Workflow skill "${skill.name}" — trigger workflow: ${skill.implementationCode}]`;
        break;
      default:
        throw new Error(`Unknown implementation type: ${skill.implementationType}`);
    }

    return {
      success: true,
      output,
      duration: Date.now() - start,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Skill execution failed [${skill.name}]:`, msg);
    return {
      success: false,
      output: "",
      duration: Date.now() - start,
      error: msg,
    };
  }
}

async function executePromptSkill(
  skill: Skill,
  input: string,
  context?: SkillExecutionContext,
): Promise<string> {
  const systemPrompt = skill.implementationCode || skill.description;

  const messages = [
    { role: "system", content: systemPrompt },
  ];

  if (context?.conversationHistory?.length) {
    for (const msg of context.conversationHistory.slice(-5)) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: "user", content: input });

  return callOllama(messages);
}

async function executeFunctionSkill(
  skill: Skill,
  input: string,
  _context?: SkillExecutionContext,
): Promise<string> {
  if (!skill.implementationCode) {
    throw new Error("Function skill has no implementation code");
  }

  // Run in a limited scope — no access to node globals
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction("input", skill.implementationCode);
  const result = await fn(input);
  return typeof result === "string" ? result : JSON.stringify(result);
}

// =============================================================================
// NLP SKILL GENERATION — describe a skill in plain English → AI generates it
// =============================================================================

export async function generateSkill(
  request: SkillGenerationRequest,
): Promise<SkillGenerationResult> {
  const systemPrompt = `You are a skill generator for an AI agent platform. Given a natural language description, generate a JSON skill definition.

The skill must follow this exact JSON structure:
{
  "name": "short_snake_case_name",
  "description": "Clear one-sentence description",
  "category": "<one of: text_generation, code_generation, code_review, summarization, translation, question_answering, reasoning, math, vision, function_calling, web_search, file_operations, data_analysis, creative_writing, structured_output>",
  "implementationType": "<one of: prompt, function>",
  "implementationCode": "<the prompt text or JS function body>",
  "triggerPatterns": [
    {"type": "keyword", "pattern": "comma,separated,keywords"},
    {"type": "command", "pattern": "/command_name"}
  ],
  "examples": [
    {"input": "example input", "expectedOutput": "example output"}
  ],
  "tags": ["tag1", "tag2"]
}

For "prompt" type skills, implementationCode is a system prompt that will be given to an LLM.
For "function" type skills, implementationCode is a JS async function body that takes "input" as parameter and returns a string.

Respond ONLY with valid JSON. No markdown fences, no explanation.`;

  const userPrompt = `Generate a skill for: ${request.description}${
    request.category ? `\nPreferred category: ${request.category}` : ""
  }${
    request.examples?.length
      ? `\nExamples:\n${request.examples.map((e) => `  Input: "${e.input}" → Output: "${e.output}"`).join("\n")}`
      : ""
  }`;

  const raw = await callOllama([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  try {
    const parsed = JSON.parse(raw.trim());
    return {
      skill: {
        name: parsed.name,
        description: parsed.description,
        category: parsed.category || "text_generation",
        implementationType: parsed.implementationType || "prompt",
        implementationCode: parsed.implementationCode,
        triggerPatterns: parsed.triggerPatterns || [],
        examples: parsed.examples || [],
        tags: parsed.tags || [],
      },
      confidence: 0.8,
      suggestedTests: parsed.examples || [],
    };
  } catch (parseError) {
    logger.warn("Failed to parse generated skill JSON, returning raw:", parseError);
    // Fallback: create a prompt-based skill with the raw output as implementation
    return {
      skill: {
        name: request.description.replace(/\s+/g, "_").toLowerCase().slice(0, 40),
        description: request.description,
        category: request.category || "text_generation",
        implementationType: "prompt",
        implementationCode: raw,
        triggerPatterns: [],
        tags: [],
      },
      confidence: 0.4,
      suggestedTests: [],
    };
  }
}

// =============================================================================
// AUTONOMOUS: analyze conversation gaps → generate missing skills
// =============================================================================

export async function analyzeAndCreateMissingSkills(
  agentId: number,
  conversationHistory: Array<{ role: string; content: string }>,
): Promise<Skill[]> {
  const existingSkills = await listSkillsForAgent(agentId);
  const existingNames = existingSkills.map((s) => s.name).join(", ");

  const systemPrompt = `You are an AI agent skill analyzer. Given a conversation history and a list of existing skills, identify skills the agent is MISSING that would help it respond better.

Return a JSON array of skill descriptions (strings). Each description should be a clear, actionable sentence.
Example: ["Summarize emails into bullet points", "Translate text between languages"]

If no skills are missing, return an empty array: []

Existing skills: ${existingNames || "(none)"}

Respond ONLY with a JSON array. No markdown fences.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    {
      role: "user",
      content: "Based on this conversation, what skills am I missing?",
    },
  ];

  const raw = await callOllama(messages);
  let descriptions: string[] = [];
  try {
    descriptions = JSON.parse(raw.trim());
    if (!Array.isArray(descriptions)) descriptions = [];
  } catch {
    logger.warn("Failed to parse missing skills analysis");
    return [];
  }

  const created: Skill[] = [];
  for (const desc of descriptions.slice(0, 3)) {
    try {
      const result = await generateSkill({ description: desc });
      const skill = await createSkill(result.skill);
      await attachSkillToAgent({ agentId, skillId: skill.id });
      created.push(skill);
      logger.info(`Auto-generated skill: ${skill.name} for agent ${agentId}`);
    } catch (err) {
      logger.warn(`Failed to auto-generate skill "${desc}":`, err);
    }
  }

  return created;
}

// =============================================================================
// SELF-LEARNING — detect repeatable tasks → auto-create skills
// =============================================================================

let lastLearnAttempt = 0;
const LEARN_COOLDOWN_MS = 30_000; // 30 seconds between learn attempts

export async function suggestSkillFromMessage(
  message: string,
): Promise<string | null> {
  if (message.length < 15) return null;

  const skipPatterns =
    /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure|bye|good|great|nice|cool|lol|haha|\?|!)/i;
  if (skipPatterns.test(message.trim())) return null;

  const existing = await matchSkill(message);
  if (existing && existing.confidence >= 0.5) return null;

  try {
    const response = await callOllama([
      {
        role: "system",
        content: `You determine whether a user message describes a repeatable task that could become a bot skill.
A skill is a reusable capability like "summarize text", "translate to Spanish", "generate hashtags", etc.
If the message is a one-off question or small-talk, respond with: null
If it IS a potential skill, respond with a concise one-sentence skill description.
Respond ONLY with the description string or the word null. No quotes, no JSON.`,
      },
      { role: "user", content: message },
    ]);

    const trimmed = response.trim();
    if (trimmed === "null" || trimmed.length < 5) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export async function learnSkillFromMessage(
  message: string,
  agentId?: number,
): Promise<Skill | null> {
  const now = Date.now();
  if (now - lastLearnAttempt < LEARN_COOLDOWN_MS) return null;
  lastLearnAttempt = now;

  try {
    const description = await suggestSkillFromMessage(message);
    if (!description) return null;

    const result = await generateSkill({ description });
    if (result.confidence < 0.5) return null;

    const skill = await createSkill({
      ...result.skill,
      type: "generated",
    });

    if (agentId) {
      await attachSkillToAgent({ agentId, skillId: skill.id });
    }

    logger.info(
      `Self-learned skill: "${skill.name}" from message: "${message.slice(0, 60)}"`,
    );
    return skill;
  } catch (err) {
    logger.warn("Self-learning failed:", err);
    return null;
  }
}

// =============================================================================
// BOOTSTRAP — ensure core skills exist on first run
// =============================================================================

const BOOTSTRAP_SKILLS: CreateSkillParams[] = [
  {
    name: "summarize_text",
    description: "Summarize long text into concise bullet points",
    category: "summarization",
    implementationType: "prompt",
    implementationCode:
      "You are a summarization expert. Take the user's text and summarize it into clear, concise bullet points. Keep the most important information. Be brief.",
    triggerPatterns: [
      { type: "command", pattern: "/summarize" },
      {
        type: "keyword",
        pattern: "summarize,summary,summarise,tldr,tl;dr,bullet points",
      },
    ],
    tags: ["text", "summarization", "productivity"],
  },
  {
    name: "translate_text",
    description: "Translate text between languages",
    category: "translation",
    implementationType: "prompt",
    implementationCode:
      "You are a multilingual translator. Translate the user's text to the requested target language. If no target language is specified, translate to English. Preserve meaning, tone, and formatting.",
    triggerPatterns: [
      { type: "command", pattern: "/translate" },
      {
        type: "keyword",
        pattern:
          "translate,translation,convert to,in spanish,in french,in german,in japanese,in chinese",
      },
    ],
    tags: ["translation", "language"],
  },
  {
    name: "generate_code",
    description: "Generate code from a natural language description",
    category: "code_generation",
    implementationType: "prompt",
    implementationCode:
      "You are an expert programmer. Generate clean, working code from the user's description. Include comments. Default to TypeScript unless another language is requested. Return ONLY the code.",
    triggerPatterns: [
      { type: "command", pattern: "/code" },
      {
        type: "keyword",
        pattern:
          "write code,generate code,code for,function that,script that,program that",
      },
    ],
    tags: ["code", "programming", "generation"],
  },
  {
    name: "explain_concept",
    description: "Explain a concept in simple terms",
    category: "question_answering",
    implementationType: "prompt",
    implementationCode:
      "You are a patient teacher. Explain the concept the user asks about in simple, clear terms. Use analogies and examples. Adjust complexity based on the question.",
    triggerPatterns: [
      { type: "command", pattern: "/explain" },
      {
        type: "keyword",
        pattern: "explain,what is,what are,how does,how do,tell me about,define",
      },
    ],
    tags: ["education", "explanation", "learning"],
  },
  {
    name: "analyze_data",
    description: "Analyze data and provide insights",
    category: "data_analysis",
    implementationType: "prompt",
    implementationCode:
      "You are a data analyst. Analyze the data or information the user provides. Identify patterns, trends, outliers, and actionable insights. Present findings clearly with supporting evidence.",
    triggerPatterns: [
      { type: "command", pattern: "/analyze" },
      {
        type: "keyword",
        pattern: "analyze,analysis,insights,patterns,trends,statistics,data",
      },
    ],
    tags: ["data", "analysis", "insights"],
  },
  {
    name: "creative_writing",
    description: "Generate creative content — stories, poems, copy, posts",
    category: "creative_writing",
    implementationType: "prompt",
    implementationCode:
      "You are a creative writer. Generate engaging, original content based on the user's request. This includes stories, poems, marketing copy, social media posts, blog articles, and any other creative text. Match the requested tone and style.",
    triggerPatterns: [
      { type: "command", pattern: "/write" },
      {
        type: "keyword",
        pattern:
          "write me,write a,compose,draft,create a story,create a poem,blog post,social media post,marketing copy",
      },
    ],
    tags: ["writing", "creative", "content"],
  },
  {
    name: "review_code",
    description: "Review code for bugs, security issues, and improvements",
    category: "code_review",
    implementationType: "prompt",
    implementationCode:
      "You are a senior code reviewer. Review the code the user provides. Check for bugs, security vulnerabilities, performance issues, and style problems. Suggest specific improvements with code examples.",
    triggerPatterns: [
      { type: "command", pattern: "/review" },
      {
        type: "keyword",
        pattern:
          "review code,code review,check my code,find bugs,security review",
      },
    ],
    tags: ["code", "review", "security"],
  },
  {
    name: "extract_structured_data",
    description: "Extract structured data (JSON/CSV) from unstructured text",
    category: "structured_output",
    implementationType: "prompt",
    implementationCode:
      "You are a data extraction specialist. Extract structured data from the user's unstructured text. Return the data as clean JSON. Identify entities, relationships, dates, numbers, and categories.",
    triggerPatterns: [
      { type: "command", pattern: "/extract" },
      {
        type: "keyword",
        pattern: "extract,parse,structure,json from,csv from,data from",
      },
    ],
    tags: ["extraction", "structured", "parsing"],
  },
];

export async function ensureBootstrapSkills(): Promise<number> {
  const existing = await listSkills();
  const existingNames = new Set(existing.map((s) => s.name));
  let created = 0;

  for (const def of BOOTSTRAP_SKILLS) {
    if (!existingNames.has(def.name)) {
      try {
        await createSkill({ ...def, type: "builtin" });
        created++;
        logger.info(`Bootstrap skill created: ${def.name}`);
      } catch (err) {
        logger.warn(`Failed to bootstrap skill "${def.name}":`, err);
      }
    }
  }

  if (created > 0) {
    logger.info(`Bootstrapped ${created} new skills`);
  }
  return created;
}

// =============================================================================
// EXPORT — generate skills.md markdown file
// =============================================================================

export async function exportSkillsMarkdown(
  writeToDisk = true,
): Promise<string> {
  const allSkills = await listSkills();

  const lines: string[] = [
    "# Skills Registry",
    "",
    `> Auto-generated on ${new Date().toISOString().split("T")[0]}`,
    `> Total skills: ${allSkills.length}`,
    "",
    "## Overview",
    "",
    "Skills are reusable AI capabilities that can be:",
    "- **Used** by any agent, bot, swarm, or orchestrator",
    "- **Created** manually, generated by NLP, or self-learned by the system",
    "- **Purchased** from the JoyMarketplace skill store",
    "- **Sold** by publishing to the marketplace",
    "",
    "| # | Name | Category | Type | Implementation | Triggers | Status |",
    "|---|------|----------|------|----------------|----------|--------|",
  ];

  for (let i = 0; i < allSkills.length; i++) {
    const s = allSkills[i];
    const triggers =
      s.triggerPatterns.map((t) => `\`${t.pattern}\``).join(", ") || "—";
    lines.push(
      `| ${i + 1} | **${s.name}** | ${s.category} | ${s.type} | ${s.implementationType} | ${triggers} | ${s.enabled ? "✅" : "❌"} |`,
    );
  }

  lines.push("");

  const byCategory = new Map<string, Skill[]>();
  for (const s of allSkills) {
    const cat = s.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(s);
  }

  lines.push("## Skills by Category", "");

  for (const [category, categorySkills] of byCategory) {
    lines.push(`### ${category}`, "");

    for (const s of categorySkills) {
      lines.push(`#### ${s.name}`, "");
      lines.push(`- **Description:** ${s.description}`);
      lines.push(
        `- **Type:** ${s.type} | **Implementation:** ${s.implementationType}`,
      );
      lines.push(
        `- **Version:** ${s.version} | **Enabled:** ${s.enabled ? "Yes" : "No"}`,
      );

      if (s.triggerPatterns.length > 0) {
        lines.push("- **Triggers:**");
        for (const t of s.triggerPatterns) {
          lines.push(
            `  - \`${t.type}\`: \`${t.pattern}\`${t.priority ? ` (priority: ${t.priority})` : ""}`,
          );
        }
      }

      if (s.tags.length > 0) {
        lines.push(
          `- **Tags:** ${s.tags.map((t) => `\`${t}\``).join(", ")}`,
        );
      }

      if (s.examples.length > 0) {
        lines.push("- **Examples:**");
        for (const ex of s.examples) {
          lines.push(
            `  - Input: \`${ex.input}\` → Output: \`${ex.expectedOutput}\``,
          );
        }
      }

      if (s.implementationCode) {
        const codePreview =
          s.implementationCode.length > 200
            ? s.implementationCode.slice(0, 200) + "..."
            : s.implementationCode;
        lines.push("");
        lines.push("```");
        lines.push(codePreview);
        lines.push("```");
      }

      if (s.publishStatus !== "local") {
        lines.push(
          `- **Marketplace:** ${s.publishStatus}${s.marketplaceId ? ` (ID: ${s.marketplaceId})` : ""}`,
        );
        if (s.price > 0)
          lines.push(
            `- **Price:** $${(s.price / 100).toFixed(2)} ${s.currency}`,
          );
        if (s.downloads > 0) lines.push(`- **Downloads:** ${s.downloads}`);
        if (s.rating > 0) lines.push(`- **Rating:** ${s.rating.toFixed(1)}/5`);
      }

      lines.push("");
    }
  }

  lines.push(
    "## How Skills Work",
    "",
    "### Automatic Matching",
    "When a message arrives (via Telegram, Discord, or the web UI), the skill engine:",
    "1. Scans all enabled skills' trigger patterns against the message",
    "2. If a trigger matches with confidence ≥ 0.6, the skill executes directly",
    "3. Otherwise, the message falls through to the standard intent detection pipeline",
    "",
    "### Skill Types",
    "- **builtin** — Ships with JoyCreate, always available",
    "- **custom** — Manually created by the user",
    "- **trained** — Improved through usage and feedback",
    "- **generated** — Auto-created by the NLP skill generator or self-learning system",
    "",
    "### Implementation Types",
    "- **prompt** — System prompt sent to an LLM (Ollama local, cloud fallback)",
    "- **function** — JavaScript async function executed in a sandboxed scope",
    "- **tool** — Delegates to an agent tool (MCP, API, etc.)",
    "- **workflow** — Triggers an n8n workflow",
    "",
    "### Self-Learning",
    "The system autonomously creates skills when:",
    "- A user sends a message that looks like a repeatable task with no matching skill",
    "- An agent conversation reveals missing capabilities",
    '- A bot receives a `/teach` or `!teach` command with a description',
    "",
    "### Bot Commands",
    "| Platform | Command | Description |",
    "|----------|---------|-------------|",
    "| Telegram | `/skills` | List all available skills |",
    "| Telegram | `/teach <description>` | Teach the bot a new skill via NLP |",
    "| Discord  | `!skills` | List all available skills |",
    "| Discord  | `!teach <description>` | Teach the bot a new skill via NLP |",
    '| Voice    | "Create a skill that..." | Generate a skill by voice command |',
    "",
  );

  const md = lines.join("\n");

  if (writeToDisk) {
    const skillsMdPath = path.join(app.getPath("userData"), "skills.md");
    await fs.writeFile(skillsMdPath, md, "utf-8");
    logger.info(`Skills markdown exported to: ${skillsMdPath}`);
  }

  return md;
}

// =============================================================================
// ORCHESTRATOR SUPPORT — find or create skills for a task capability
// =============================================================================

export async function resolveSkillsForCapability(
  capability: string,
): Promise<Skill[]> {
  const existing = await listSkills({
    category: capability as Skill["category"],
    enabled: true,
  });
  if (existing.length > 0) return existing;

  const byKeyword = await listSkills({ query: capability, enabled: true });
  if (byKeyword.length > 0) return byKeyword;

  logger.info(
    `No skills found for capability "${capability}", auto-generating...`,
  );
  try {
    const result = await generateSkill({
      description: `A skill for ${capability} tasks`,
      category: capability as Skill["category"],
    });
    const skill = await createSkill({ ...result.skill, type: "generated" });
    return [skill];
  } catch (err) {
    logger.warn(
      `Failed to auto-generate skill for capability "${capability}":`,
      err,
    );
    return [];
  }
}

// =============================================================================
// HELPERS
// =============================================================================

async function callOllama(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  // 1. Try local Ollama first
  try {
    const apiUrl = `${getOllamaApiUrl()}/api/chat`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        messages,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 2048,
        },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return data.message?.content ?? "";
    }

    logger.warn(
      `Ollama API error: ${response.status} ${response.statusText} — falling back to AI SDK`,
    );
  } catch (ollamaErr) {
    logger.warn("Ollama unavailable — falling back to AI SDK:", ollamaErr);
  }

  // 2. Fallback — use the user's configured AI provider via AI SDK
  const { generateText } = await import("ai");
  const { getModelClient } = await import("@/ipc/utils/get_model_client");
  const { readSettings } = await import("@/main/settings");

  const settings = readSettings();
  const { modelClient } = await getModelClient(settings.selectedModel, settings);

  const system = messages.find((m) => m.role === "system")?.content;
  const userMessages = messages.filter((m) => m.role !== "system");
  const prompt = userMessages.map((m) => m.content).join("\n\n");

  const result = await generateText({
    model: modelClient.model,
    system,
    prompt,
    maxOutputTokens: 2048,
  });

  return result.text;
}

function rowToSkill(row: typeof skills.$inferSelect): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category as Skill["category"],
    type: row.type ?? "custom",
    implementationType: row.implementationType ?? "prompt",
    implementationCode: row.implementationCode,
    triggerPatterns: (row.triggerPatterns as SkillTriggerPattern[]) ?? [],
    inputSchema: row.inputSchema as Record<string, unknown> | null,
    outputSchema: row.outputSchema as Record<string, unknown> | null,
    examples: (row.examples as Skill["examples"]) ?? [],
    tags: (row.tags as string[]) ?? [],
    version: row.version,
    authorId: row.authorId,
    publishStatus: row.publishStatus ?? "local",
    marketplaceId: row.marketplaceId,
    price: row.price ?? 0,
    currency: row.currency ?? "USD",
    downloads: row.downloads ?? 0,
    rating: row.rating ?? 0,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
