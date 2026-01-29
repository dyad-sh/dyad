/**
 * Agent Factory IPC Handlers
 * Handles creation, training, and management of custom AI agents
 */

import { IpcMainInvokeEvent, ipcMain, BrowserWindow } from "electron";
import { db } from "@/db";
import { eq, desc } from "drizzle-orm";
import log from "electron-log";
import path from "path";
import fs from "fs/promises";
import { app } from "electron";

import type {
  CreateCustomAgentParams,
  CustomAgentInfo,
  UpdateCustomAgentParams,
  StartAgentTrainingParams,
  AddAgentSkillParams,
  AddAgentToolParams,
  TestAgentParams,
  TestAgentResult,
  AdapterInfo,
} from "../ipc_types";

import { fetchOllamaModels, getOllamaApiUrl } from "./local_model_ollama_handler";

const logger = log.scope("agent_factory_handlers");

// In-memory store for custom agents (would be database in production)
const customAgents = new Map<string, CustomAgentInfo & { 
  skills: any[]; 
  tools: any[];
  modelConfig: any;
  behaviorConfig: any;
}>();

// Agent training jobs
const agentTrainingJobs = new Map<string, {
  agentId: string;
  jobId: string;
  status: string;
  progress: number;
}>();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateAgentId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getAgentsDir(): string {
  return path.join(app.getPath("userData"), "agents");
}

async function ensureAgentsDir(): Promise<void> {
  await fs.mkdir(getAgentsDir(), { recursive: true });
}

async function saveAgentToFile(agent: CustomAgentInfo & { skills: any[]; tools: any[] }): Promise<void> {
  await ensureAgentsDir();
  const filePath = path.join(getAgentsDir(), `${agent.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(agent, null, 2), "utf-8");
}

async function loadAgentsFromDisk(): Promise<void> {
  try {
    await ensureAgentsDir();
    const files = await fs.readdir(getAgentsDir());
    
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const filePath = path.join(getAgentsDir(), file);
          const data = await fs.readFile(filePath, "utf-8");
          const agent = JSON.parse(data);
          customAgents.set(agent.id, agent);
        } catch (e) {
          logger.warn(`Failed to load agent file: ${file}`, e);
        }
      }
    }
    
    logger.info(`Loaded ${customAgents.size} agents from disk`);
  } catch (e) {
    logger.warn("Failed to load agents from disk:", e);
  }
}

// =============================================================================
// AGENT CRUD OPERATIONS
// =============================================================================

export async function handleCreateCustomAgent(
  _event: IpcMainInvokeEvent,
  params: CreateCustomAgentParams
): Promise<CustomAgentInfo> {
  logger.info("Creating custom agent:", params.name);
  
  const agentId = generateAgentId();
  
  const agent = {
    id: agentId,
    name: params.name,
    displayName: params.displayName,
    description: params.description,
    type: params.type,
    personality: params.personality || "professional",
    baseModelId: params.baseModelId,
    systemPrompt: params.systemPrompt,
    status: "draft",
    adapterId: params.adapterId,
    adapterName: undefined as string | undefined,
    version: "1.0.0",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    skills: [] as any[],
    tools: [] as any[],
    modelConfig: {
      provider: params.baseModelProvider,
      modelId: params.baseModelId,
      maxTokens: params.maxTokens || 2048,
      temperature: params.temperature || 0.7,
    },
    behaviorConfig: {
      responseStyle: "conversational",
      useChainOfThought: false,
      showReasoningSteps: false,
    },
  };
  
  customAgents.set(agentId, agent);
  await saveAgentToFile(agent);
  
  logger.info("Agent created:", agentId);
  
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    description: agent.description,
    type: agent.type,
    personality: agent.personality,
    baseModelId: agent.baseModelId,
    systemPrompt: agent.systemPrompt,
    status: agent.status,
    adapterId: agent.adapterId,
    version: agent.version,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export async function handleGetCustomAgent(
  _event: IpcMainInvokeEvent,
  agentId: string
): Promise<CustomAgentInfo | null> {
  const agent = customAgents.get(agentId);
  
  if (!agent) {
    return null;
  }
  
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    description: agent.description,
    type: agent.type,
    personality: agent.personality,
    baseModelId: agent.baseModelId,
    systemPrompt: agent.systemPrompt,
    status: agent.status,
    adapterId: agent.adapterId,
    adapterName: agent.adapterName,
    version: agent.version,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export async function handleListCustomAgents(): Promise<CustomAgentInfo[]> {
  const agents = Array.from(customAgents.values());
  
  return agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    description: agent.description,
    type: agent.type,
    personality: agent.personality,
    baseModelId: agent.baseModelId,
    systemPrompt: agent.systemPrompt,
    status: agent.status,
    adapterId: agent.adapterId,
    adapterName: agent.adapterName,
    version: agent.version,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function handleUpdateCustomAgent(
  _event: IpcMainInvokeEvent,
  params: UpdateCustomAgentParams
): Promise<CustomAgentInfo> {
  const agent = customAgents.get(params.id);
  
  if (!agent) {
    throw new Error(`Agent not found: ${params.id}`);
  }
  
  logger.info("Updating agent:", params.id);
  
  if (params.name !== undefined) agent.name = params.name;
  if (params.displayName !== undefined) agent.displayName = params.displayName;
  if (params.description !== undefined) agent.description = params.description;
  if (params.systemPrompt !== undefined) agent.systemPrompt = params.systemPrompt;
  if (params.adapterId !== undefined) agent.adapterId = params.adapterId;
  if (params.maxTokens !== undefined) agent.modelConfig.maxTokens = params.maxTokens;
  if (params.temperature !== undefined) agent.modelConfig.temperature = params.temperature;
  
  agent.updatedAt = Date.now();
  
  await saveAgentToFile(agent);
  
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    description: agent.description,
    type: agent.type,
    personality: agent.personality,
    baseModelId: agent.baseModelId,
    systemPrompt: agent.systemPrompt,
    status: agent.status,
    adapterId: agent.adapterId,
    adapterName: agent.adapterName,
    version: agent.version,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

export async function handleDeleteCustomAgent(
  _event: IpcMainInvokeEvent,
  agentId: string
): Promise<void> {
  logger.info("Deleting agent:", agentId);
  
  customAgents.delete(agentId);
  
  // Delete from disk
  try {
    const filePath = path.join(getAgentsDir(), `${agentId}.json`);
    await fs.unlink(filePath);
  } catch {
    // File may not exist
  }
}

export async function handleDuplicateCustomAgent(
  _event: IpcMainInvokeEvent,
  agentId: string
): Promise<CustomAgentInfo> {
  const original = customAgents.get(agentId);
  
  if (!original) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  logger.info("Duplicating agent:", agentId);
  
  const newId = generateAgentId();
  
  const duplicate = {
    ...JSON.parse(JSON.stringify(original)),
    id: newId,
    name: `${original.name} (Copy)`,
    displayName: `${original.displayName} (Copy)`,
    status: "draft",
    version: "1.0.0",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  customAgents.set(newId, duplicate);
  await saveAgentToFile(duplicate);
  
  return {
    id: duplicate.id,
    name: duplicate.name,
    displayName: duplicate.displayName,
    description: duplicate.description,
    type: duplicate.type,
    personality: duplicate.personality,
    baseModelId: duplicate.baseModelId,
    systemPrompt: duplicate.systemPrompt,
    status: duplicate.status,
    adapterId: duplicate.adapterId,
    version: duplicate.version,
    createdAt: duplicate.createdAt,
    updatedAt: duplicate.updatedAt,
  };
}

// =============================================================================
// TRAINING OPERATIONS
// =============================================================================

export async function handleStartAgentTraining(
  _event: IpcMainInvokeEvent,
  params: StartAgentTrainingParams
): Promise<{ jobId: string }> {
  const agent = customAgents.get(params.agentId);
  
  if (!agent) {
    throw new Error(`Agent not found: ${params.agentId}`);
  }
  
  logger.info("Starting agent training:", params.agentId);
  
  // Create training job via model factory
  const jobId = `train_${params.agentId}_${Date.now()}`;
  
  agentTrainingJobs.set(params.agentId, {
    agentId: params.agentId,
    jobId,
    status: "queued",
    progress: 0,
  });
  
  agent.status = "training";
  agent.updatedAt = Date.now();
  await saveAgentToFile(agent);
  
  // The actual training would be delegated to model_factory_handlers
  // For now, we set up the tracking
  
  return { jobId };
}

export async function handleGetAgentTrainingStatus(
  _event: IpcMainInvokeEvent,
  agentId: string
): Promise<{ status: string; progress: number; jobId?: string } | null> {
  const job = agentTrainingJobs.get(agentId);
  return job || null;
}

export async function handleCancelAgentTraining(
  _event: IpcMainInvokeEvent,
  agentId: string
): Promise<void> {
  const agent = customAgents.get(agentId);
  const job = agentTrainingJobs.get(agentId);
  
  if (job) {
    logger.info("Cancelling agent training:", agentId);
    agentTrainingJobs.delete(agentId);
  }
  
  if (agent) {
    agent.status = "draft";
    agent.updatedAt = Date.now();
    await saveAgentToFile(agent);
  }
}

// =============================================================================
// SKILLS MANAGEMENT
// =============================================================================

export async function handleAddAgentSkill(
  _event: IpcMainInvokeEvent,
  params: AddAgentSkillParams
): Promise<{ skillId: string }> {
  const agent = customAgents.get(params.agentId);
  
  if (!agent) {
    throw new Error(`Agent not found: ${params.agentId}`);
  }
  
  const skillId = `skill_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  
  const skill = {
    id: skillId,
    name: params.name,
    description: params.description,
    type: params.type,
    implementation: params.implementation,
    examples: params.examples || [],
    enabled: true,
    createdAt: Date.now(),
  };
  
  agent.skills.push(skill);
  agent.updatedAt = Date.now();
  await saveAgentToFile(agent);
  
  logger.info("Added skill to agent:", params.agentId, skillId);
  
  return { skillId };
}

export async function handleRemoveAgentSkill(
  _event: IpcMainInvokeEvent,
  agentId: string,
  skillId: string
): Promise<void> {
  const agent = customAgents.get(agentId);
  
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  agent.skills = agent.skills.filter(s => s.id !== skillId);
  agent.updatedAt = Date.now();
  await saveAgentToFile(agent);
  
  logger.info("Removed skill from agent:", agentId, skillId);
}

export async function handleListAgentSkills(
  _event: IpcMainInvokeEvent,
  agentId: string
): Promise<any[]> {
  const agent = customAgents.get(agentId);
  
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  return agent.skills;
}

// =============================================================================
// TOOLS MANAGEMENT
// =============================================================================

export async function handleAddAgentTool(
  _event: IpcMainInvokeEvent,
  params: AddAgentToolParams
): Promise<{ toolId: string }> {
  const agent = customAgents.get(params.agentId);
  
  if (!agent) {
    throw new Error(`Agent not found: ${params.agentId}`);
  }
  
  const toolId = `tool_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  
  const tool = {
    id: toolId,
    name: params.name,
    description: params.description,
    inputSchema: params.inputSchema,
    implementation: params.implementation,
    requiresApproval: params.requiresApproval ?? false,
    enabled: true,
    usageCount: 0,
    createdAt: Date.now(),
  };
  
  agent.tools.push(tool);
  agent.updatedAt = Date.now();
  await saveAgentToFile(agent);
  
  logger.info("Added tool to agent:", params.agentId, toolId);
  
  return { toolId };
}

export async function handleRemoveAgentTool(
  _event: IpcMainInvokeEvent,
  agentId: string,
  toolId: string
): Promise<void> {
  const agent = customAgents.get(agentId);
  
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  agent.tools = agent.tools.filter(t => t.id !== toolId);
  agent.updatedAt = Date.now();
  await saveAgentToFile(agent);
  
  logger.info("Removed tool from agent:", agentId, toolId);
}

export async function handleListAgentTools(
  _event: IpcMainInvokeEvent,
  agentId: string
): Promise<any[]> {
  const agent = customAgents.get(agentId);
  
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  return agent.tools;
}

// =============================================================================
// TESTING
// =============================================================================

export async function handleTestAgent(
  _event: IpcMainInvokeEvent,
  params: TestAgentParams
): Promise<TestAgentResult> {
  const agent = customAgents.get(params.agentId);
  
  if (!agent) {
    throw new Error(`Agent not found: ${params.agentId}`);
  }
  
  logger.info("Testing agent:", params.agentId);
  
  const startTime = Date.now();
  
  // Build the prompt with system prompt
  const messages = [
    { role: "system", content: agent.systemPrompt },
  ];
  
  if (params.context) {
    messages.push({ role: "system", content: `Context: ${params.context}` });
  }
  
  messages.push({ role: "user", content: params.input });
  
  // Call Ollama API
  try {
    const apiUrl = `${getOllamaApiUrl()}/api/chat`;
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: agent.baseModelId,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: {
          temperature: agent.modelConfig.temperature,
          num_predict: agent.modelConfig.maxTokens,
        },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    const responseTimeMs = Date.now() - startTime;
    
    return {
      output: data.message?.content || "",
      tokensUsed: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      responseTimeMs,
    };
  } catch (error) {
    logger.error("Agent test failed:", error);
    throw new Error(`Failed to test agent: ${error}`);
  }
}

// =============================================================================
// ADAPTER MANAGEMENT
// =============================================================================

export async function handleSetAgentAdapter(
  _event: IpcMainInvokeEvent,
  agentId: string,
  adapterId: string | null
): Promise<void> {
  const agent = customAgents.get(agentId);
  
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  logger.info("Setting agent adapter:", agentId, adapterId);
  
  agent.adapterId = adapterId || undefined;
  agent.updatedAt = Date.now();
  await saveAgentToFile(agent);
}

// =============================================================================
// TEMPLATES
// =============================================================================

const agentTemplates = [
  {
    id: "coding-assistant",
    name: "Coding Assistant",
    description: "An AI agent specialized in code generation and review",
    type: "coding",
    personality: "professional",
    systemPrompt: `You are an expert coding assistant. You help users write, review, and debug code.
    
Key behaviors:
- Write clean, well-documented code
- Follow best practices and design patterns
- Explain your code clearly
- Suggest improvements when reviewing code
- Be concise but thorough`,
    config: {
      temperature: 0.3,
      maxTokens: 4096,
    },
  },
  {
    id: "research-analyst",
    name: "Research Analyst",
    description: "An AI agent for research and analysis tasks",
    type: "research",
    personality: "analytical",
    systemPrompt: `You are a thorough research analyst. You help users research topics and analyze information.
    
Key behaviors:
- Provide well-researched, factual information
- Cite sources when possible
- Present multiple perspectives on topics
- Analyze data objectively
- Acknowledge limitations and uncertainties`,
    config: {
      temperature: 0.5,
      maxTokens: 4096,
    },
  },
  {
    id: "creative-writer",
    name: "Creative Writer",
    description: "An AI agent for creative writing and content generation",
    type: "creative",
    personality: "creative",
    systemPrompt: `You are a creative writing assistant. You help users with creative writing, storytelling, and content creation.
    
Key behaviors:
- Be imaginative and original
- Adapt to different writing styles
- Help develop characters and plots
- Provide constructive feedback on writing
- Encourage creativity while maintaining quality`,
    config: {
      temperature: 0.8,
      maxTokens: 4096,
    },
  },
  {
    id: "data-analyst",
    name: "Data Analyst",
    description: "An AI agent for data analysis and visualization",
    type: "data",
    personality: "analytical",
    systemPrompt: `You are a data analysis assistant. You help users analyze data, create visualizations, and derive insights.
    
Key behaviors:
- Provide clear data interpretations
- Suggest appropriate analysis methods
- Help with data cleaning and preparation
- Create meaningful visualizations
- Explain statistical concepts clearly`,
    config: {
      temperature: 0.3,
      maxTokens: 4096,
    },
  },
  {
    id: "task-executor",
    name: "Task Executor",
    description: "An autonomous agent for executing multi-step tasks",
    type: "autonomous",
    personality: "professional",
    systemPrompt: `You are an autonomous task execution agent. You help users complete complex, multi-step tasks.
    
Key behaviors:
- Break down complex tasks into steps
- Execute tasks systematically
- Report progress clearly
- Handle errors gracefully
- Ask for clarification when needed`,
    config: {
      temperature: 0.3,
      maxTokens: 4096,
    },
  },
];

export async function handleListAgentTemplates(): Promise<typeof agentTemplates> {
  return agentTemplates;
}

export async function handleCreateAgentFromTemplate(
  _event: IpcMainInvokeEvent,
  templateId: string,
  params: { name: string; displayName: string; baseModelId: string }
): Promise<CustomAgentInfo> {
  const template = agentTemplates.find(t => t.id === templateId);
  
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  
  return handleCreateCustomAgent(_event, {
    name: params.name,
    displayName: params.displayName,
    description: template.description,
    type: template.type,
    personality: template.personality,
    baseModelProvider: "ollama",
    baseModelId: params.baseModelId,
    systemPrompt: template.systemPrompt,
    maxTokens: template.config.maxTokens,
    temperature: template.config.temperature,
  });
}

// =============================================================================
// EXPORT/IMPORT
// =============================================================================

export async function handleExportAgent(
  _event: IpcMainInvokeEvent,
  agentId: string
): Promise<string> {
  const agent = customAgents.get(agentId);
  
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  
  return JSON.stringify(agent, null, 2);
}

export async function handleImportAgent(
  _event: IpcMainInvokeEvent,
  agentJson: string
): Promise<CustomAgentInfo> {
  const imported = JSON.parse(agentJson);
  
  // Generate new ID
  const newId = generateAgentId();
  
  const agent = {
    ...imported,
    id: newId,
    name: `${imported.name} (Imported)`,
    status: "draft",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  customAgents.set(newId, agent);
  await saveAgentToFile(agent);
  
  return {
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    description: agent.description,
    type: agent.type,
    personality: agent.personality,
    baseModelId: agent.baseModelId,
    systemPrompt: agent.systemPrompt,
    status: agent.status,
    adapterId: agent.adapterId,
    version: agent.version,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

// =============================================================================
// REGISTER HANDLERS
// =============================================================================

export function registerAgentFactoryHandlers() {
  logger.info("Registering agent factory handlers...");
  
  // Load existing agents from disk
  loadAgentsFromDisk().catch(e => logger.error("Failed to load agents:", e));
  
  // Agent CRUD
  ipcMain.handle("agent-factory:create", handleCreateCustomAgent);
  ipcMain.handle("agent-factory:get", handleGetCustomAgent);
  ipcMain.handle("agent-factory:list", handleListCustomAgents);
  ipcMain.handle("agent-factory:update", handleUpdateCustomAgent);
  ipcMain.handle("agent-factory:delete", handleDeleteCustomAgent);
  ipcMain.handle("agent-factory:duplicate", handleDuplicateCustomAgent);
  
  // Training
  ipcMain.handle("agent-factory:start-training", handleStartAgentTraining);
  ipcMain.handle("agent-factory:training-status", handleGetAgentTrainingStatus);
  ipcMain.handle("agent-factory:cancel-training", handleCancelAgentTraining);
  
  // Skills
  ipcMain.handle("agent-factory:add-skill", handleAddAgentSkill);
  ipcMain.handle("agent-factory:remove-skill", handleRemoveAgentSkill);
  ipcMain.handle("agent-factory:list-skills", handleListAgentSkills);
  
  // Tools
  ipcMain.handle("agent-factory:add-tool", handleAddAgentTool);
  ipcMain.handle("agent-factory:remove-tool", handleRemoveAgentTool);
  ipcMain.handle("agent-factory:list-tools", handleListAgentTools);
  
  // Testing
  ipcMain.handle("agent-factory:test", handleTestAgent);
  
  // Adapter
  ipcMain.handle("agent-factory:set-adapter", handleSetAgentAdapter);
  
  // Templates
  ipcMain.handle("agent-factory:list-templates", handleListAgentTemplates);
  ipcMain.handle("agent-factory:create-from-template", handleCreateAgentFromTemplate);
  
  // Export/Import
  ipcMain.handle("agent-factory:export", handleExportAgent);
  ipcMain.handle("agent-factory:import", handleImportAgent);
  
  logger.info("Agent factory handlers registered");
}
