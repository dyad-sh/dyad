/**
 * Agent Builder IPC Handlers
 * Handles CRUD operations for AI agents, tools, workflows, and deployments
 */

import { IpcMainInvokeEvent, ipcMain } from "electron";
import { db } from "@/db";
import {
  agents,
  agentTools,
  agentWorkflows,
  agentDeployments,
  agentTestSessions,
  agentKnowledgeBases,
  agentUIComponents,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import log from "electron-log";

import type {
  CreateAgentRequest,
  UpdateAgentRequest,
  CreateAgentToolRequest,
  UpdateAgentToolRequest,
  DeployAgentRequest,
  Agent,
  AgentTool,
  AgentWorkflow,
  AgentDeployment,
  AgentTestSession,
  AgentKnowledgeBase,
  AgentUIComponent,
} from "@/types/agent_builder";

const logger = log.scope("agent_builder_handlers");

// ============================================================================
// Agent CRUD Operations
// ============================================================================

export async function handleCreateAgent(
  _event: IpcMainInvokeEvent,
  request: CreateAgentRequest
): Promise<Agent> {
  logger.info("Creating agent:", request.name);

  const [agent] = await db
    .insert(agents)
    .values({
      name: request.name,
      description: request.description,
      type: request.type,
      systemPrompt: request.systemPrompt,
      modelId: request.modelId,
      configJson: request.config ?? null,
      status: "draft",
      version: "1.0.0",
    })
    .returning();

  logger.info("Agent created:", agent.id);
  return mapAgentFromDb(agent);
}

export async function handleGetAgent(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<Agent | null> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    with: {
      tools: true,
      workflows: true,
      deployments: true,
      knowledgeBases: true,
      uiComponents: true,
    },
  });

  return agent ? mapAgentFromDb(agent) : null;
}

export async function handleListAgents(
  _event: IpcMainInvokeEvent
): Promise<Agent[]> {
  const agentList = await db.query.agents.findMany({
    orderBy: [desc(agents.updatedAt)],
  });

  return agentList.map(mapAgentFromDb);
}

export async function handleUpdateAgent(
  _event: IpcMainInvokeEvent,
  request: UpdateAgentRequest
): Promise<Agent> {
  logger.info("Updating agent:", request.id);

  const updateData: Record<string, unknown> = {};

  if (request.name !== undefined) updateData.name = request.name;
  if (request.description !== undefined) updateData.description = request.description;
  if (request.type !== undefined) updateData.type = request.type;
  if (request.status !== undefined) updateData.status = request.status;
  if (request.systemPrompt !== undefined) updateData.systemPrompt = request.systemPrompt;
  if (request.modelId !== undefined) updateData.modelId = request.modelId;
  if (request.temperature !== undefined) updateData.temperature = request.temperature;
  if (request.maxTokens !== undefined) updateData.maxTokens = request.maxTokens;
  if (request.config !== undefined) updateData.configJson = request.config;

  const [updated] = await db
    .update(agents)
    .set(updateData)
    .where(eq(agents.id, request.id))
    .returning();

  if (!updated) {
    throw new Error(`Agent not found: ${request.id}`);
  }

  return mapAgentFromDb(updated);
}

export async function handleDeleteAgent(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<void> {
  logger.info("Deleting agent:", agentId);

  await db.delete(agents).where(eq(agents.id, agentId));
}

export async function handleDuplicateAgent(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<Agent> {
  const original = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    with: {
      tools: true,
      workflows: true,
    },
  });

  if (!original) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Create duplicate agent
  const [duplicated] = await db
    .insert(agents)
    .values({
      name: `${original.name} (Copy)`,
      description: original.description,
      type: original.type,
      systemPrompt: original.systemPrompt,
      modelId: original.modelId,
      temperature: original.temperature,
      maxTokens: original.maxTokens,
      configJson: original.configJson,
      status: "draft",
      version: "1.0.0",
    })
    .returning();

  // Duplicate tools
  if (original.tools && original.tools.length > 0) {
    await db.insert(agentTools).values(
      original.tools.map((tool) => ({
        agentId: duplicated.id,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        implementationCode: tool.implementationCode,
        requiresApproval: tool.requiresApproval,
        enabled: tool.enabled,
      }))
    );
  }

  // Duplicate workflows
  if (original.workflows && original.workflows.length > 0) {
    await db.insert(agentWorkflows).values(
      original.workflows.map((workflow) => ({
        agentId: duplicated.id,
        name: workflow.name,
        description: workflow.description,
        workflowJson: workflow.workflowJson,
        isDefault: workflow.isDefault,
      }))
    );
  }

  return mapAgentFromDb(duplicated);
}

// ============================================================================
// Agent Tool Operations
// ============================================================================

export async function handleCreateAgentTool(
  _event: IpcMainInvokeEvent,
  request: CreateAgentToolRequest
): Promise<AgentTool> {
  logger.info("Creating tool for agent:", request.agentId);

  const [tool] = await db
    .insert(agentTools)
    .values({
      agentId: request.agentId,
      name: request.name,
      description: request.description,
      inputSchema: (request.inputSchema as unknown as Record<string, unknown>) ?? null,
      implementationCode: request.implementationCode,
      requiresApproval: request.requiresApproval ?? false,
      enabled: true,
    })
    .returning();

  return mapToolFromDb(tool);
}

export async function handleGetAgentTools(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<AgentTool[]> {
  const tools = await db.query.agentTools.findMany({
    where: eq(agentTools.agentId, agentId),
  });

  return tools.map(mapToolFromDb);
}

export async function handleUpdateAgentTool(
  _event: IpcMainInvokeEvent,
  request: UpdateAgentToolRequest
): Promise<AgentTool> {
  const updateData: Record<string, unknown> = {};

  if (request.name !== undefined) updateData.name = request.name;
  if (request.description !== undefined) updateData.description = request.description;
  if (request.inputSchema !== undefined) updateData.inputSchema = request.inputSchema;
  if (request.implementationCode !== undefined) updateData.implementationCode = request.implementationCode;
  if (request.requiresApproval !== undefined) updateData.requiresApproval = request.requiresApproval;
  if (request.enabled !== undefined) updateData.enabled = request.enabled;

  const [updated] = await db
    .update(agentTools)
    .set(updateData)
    .where(eq(agentTools.id, request.id))
    .returning();

  if (!updated) {
    throw new Error(`Tool not found: ${request.id}`);
  }

  return mapToolFromDb(updated);
}

export async function handleDeleteAgentTool(
  _event: IpcMainInvokeEvent,
  toolId: number
): Promise<void> {
  await db.delete(agentTools).where(eq(agentTools.id, toolId));
}

// ============================================================================
// Agent Workflow Operations
// ============================================================================

export async function handleCreateAgentWorkflow(
  _event: IpcMainInvokeEvent,
  agentId: number,
  name: string,
  description?: string
): Promise<AgentWorkflow> {
  const [workflow] = await db
    .insert(agentWorkflows)
    .values({
      agentId,
      name,
      description,
      workflowJson: {
        nodes: [],
        edges: [],
        entryNodeId: "",
      },
      isDefault: false,
    })
    .returning();

  return mapWorkflowFromDb(workflow);
}

export async function handleGetAgentWorkflows(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<AgentWorkflow[]> {
  const workflows = await db.query.agentWorkflows.findMany({
    where: eq(agentWorkflows.agentId, agentId),
  });

  return workflows.map(mapWorkflowFromDb);
}

export async function handleUpdateAgentWorkflow(
  _event: IpcMainInvokeEvent,
  workflowId: number,
  updates: Partial<AgentWorkflow>
): Promise<AgentWorkflow> {
  const updateData: Record<string, unknown> = {};

  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.description !== undefined) updateData.description = updates.description;
  if (updates.definition !== undefined) updateData.workflowJson = updates.definition;
  if (updates.isDefault !== undefined) updateData.isDefault = updates.isDefault;

  const [updated] = await db
    .update(agentWorkflows)
    .set(updateData)
    .where(eq(agentWorkflows.id, workflowId))
    .returning();

  if (!updated) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  return mapWorkflowFromDb(updated);
}

export async function handleDeleteAgentWorkflow(
  _event: IpcMainInvokeEvent,
  workflowId: number
): Promise<void> {
  await db.delete(agentWorkflows).where(eq(agentWorkflows.id, workflowId));
}

// ============================================================================
// Agent Deployment Operations
// ============================================================================

export async function handleDeployAgent(
  _event: IpcMainInvokeEvent,
  request: DeployAgentRequest
): Promise<AgentDeployment> {
  logger.info("Deploying agent:", request.agentId, "to", request.target);

  const [deployment] = await db
    .insert(agentDeployments)
    .values({
      agentId: request.agentId,
      target: request.target,
      deploymentConfigJson: request.config ?? null,
      deploymentStatus: "pending",
    })
    .returning();

  // TODO: Implement actual deployment logic based on target
  // For now, just create the deployment record

  return mapDeploymentFromDb(deployment);
}

export async function handleGetAgentDeployments(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<AgentDeployment[]> {
  const deployments = await db.query.agentDeployments.findMany({
    where: eq(agentDeployments.agentId, agentId),
    orderBy: [desc(agentDeployments.createdAt)],
  });

  return deployments.map(mapDeploymentFromDb);
}

export async function handleStopDeployment(
  _event: IpcMainInvokeEvent,
  deploymentId: number
): Promise<void> {
  await db
    .update(agentDeployments)
    .set({ deploymentStatus: "stopped" })
    .where(eq(agentDeployments.id, deploymentId));
}

// ============================================================================
// Agent Test Session Operations
// ============================================================================

export async function handleCreateTestSession(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<AgentTestSession> {
  const [session] = await db
    .insert(agentTestSessions)
    .values({
      agentId,
      messagesJson: [],
      metricsJson: {
        totalMessages: 0,
        toolCallCount: 0,
        errorCount: 0,
      },
    })
    .returning();

  return mapTestSessionFromDb(session);
}

export async function handleGetTestSessions(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<AgentTestSession[]> {
  const sessions = await db.query.agentTestSessions.findMany({
    where: eq(agentTestSessions.agentId, agentId),
    orderBy: [desc(agentTestSessions.createdAt)],
  });

  return sessions.map(mapTestSessionFromDb);
}

// ============================================================================
// Agent Knowledge Base Operations
// ============================================================================

export async function handleCreateKnowledgeBase(
  _event: IpcMainInvokeEvent,
  agentId: number,
  name: string,
  sourceType: string,
  config?: Record<string, unknown>
): Promise<AgentKnowledgeBase> {
  const [kb] = await db
    .insert(agentKnowledgeBases)
    .values({
      agentId,
      name,
      sourceType,
      sourceConfigJson: config ?? null,
      indexStatus: "pending",
      documentCount: 0,
    })
    .returning();

  return mapKnowledgeBaseFromDb(kb);
}

export async function handleGetKnowledgeBases(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<AgentKnowledgeBase[]> {
  const kbs = await db.query.agentKnowledgeBases.findMany({
    where: eq(agentKnowledgeBases.agentId, agentId),
  });

  return kbs.map(mapKnowledgeBaseFromDb);
}

// ============================================================================
// Agent UI Component Operations
// ============================================================================

export async function handleCreateUIComponent(
  _event: IpcMainInvokeEvent,
  agentId: number,
  name: string,
  componentType: string,
  code?: string
): Promise<AgentUIComponent> {
  const [component] = await db
    .insert(agentUIComponents)
    .values({
      agentId,
      name,
      componentType,
      code,
    })
    .returning();

  return mapUIComponentFromDb(component);
}

export async function handleGetUIComponents(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<AgentUIComponent[]> {
  const components = await db.query.agentUIComponents.findMany({
    where: eq(agentUIComponents.agentId, agentId),
  });

  return components.map(mapUIComponentFromDb);
}

// ============================================================================
// Mapping Functions
// ============================================================================

function mapAgentFromDb(agent: typeof agents.$inferSelect): Agent {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description ?? undefined,
    type: agent.type ?? "chatbot",
    status: agent.status ?? "draft",
    appId: agent.appId ?? undefined,
    systemPrompt: agent.systemPrompt ?? undefined,
    modelId: agent.modelId ?? undefined,
    temperature: agent.temperature ?? undefined,
    maxTokens: agent.maxTokens ?? undefined,
    config: agent.configJson ?? undefined,
    version: agent.version,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

function mapToolFromDb(tool: typeof agentTools.$inferSelect): AgentTool {
  return {
    id: tool.id,
    agentId: tool.agentId,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as unknown as AgentTool["inputSchema"],
    implementationCode: tool.implementationCode ?? undefined,
    requiresApproval: tool.requiresApproval,
    enabled: tool.enabled,
    createdAt: tool.createdAt,
    updatedAt: tool.updatedAt,
  };
}

function mapWorkflowFromDb(workflow: typeof agentWorkflows.$inferSelect): AgentWorkflow {
  return {
    id: workflow.id,
    agentId: workflow.agentId,
    name: workflow.name,
    description: workflow.description ?? undefined,
    definition: workflow.workflowJson as unknown as AgentWorkflow["definition"],
    isDefault: workflow.isDefault,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function mapDeploymentFromDb(deployment: typeof agentDeployments.$inferSelect): AgentDeployment {
  return {
    id: deployment.id,
    agentId: deployment.agentId,
    target: deployment.target ?? "local",
    config: deployment.deploymentConfigJson ?? undefined,
    endpoint: deployment.endpoint ?? undefined,
    status: deployment.deploymentStatus as AgentDeployment["status"],
    deployedAt: deployment.deployedAt ?? undefined,
    createdAt: deployment.createdAt,
    updatedAt: deployment.updatedAt,
  };
}

function mapTestSessionFromDb(session: typeof agentTestSessions.$inferSelect): AgentTestSession {
  return {
    id: session.id,
    agentId: session.agentId,
    messages: session.messagesJson as unknown as AgentTestSession["messages"],
    metrics: session.metricsJson ?? undefined,
    createdAt: session.createdAt,
  };
}

function mapKnowledgeBaseFromDb(kb: typeof agentKnowledgeBases.$inferSelect): AgentKnowledgeBase {
  return {
    id: kb.id,
    agentId: kb.agentId,
    name: kb.name,
    description: kb.description ?? undefined,
    sourceType: kb.sourceType as AgentKnowledgeBase["sourceType"],
    sourceConfig: kb.sourceConfigJson as unknown as AgentKnowledgeBase["sourceConfig"],
    embeddingModel: kb.embeddingModel ?? undefined,
    chunkSize: kb.chunkSize ?? 1000,
    chunkOverlap: kb.chunkOverlap ?? 200,
    indexStatus: kb.indexStatus as AgentKnowledgeBase["indexStatus"],
    documentCount: kb.documentCount ?? 0,
    createdAt: kb.createdAt,
    updatedAt: kb.updatedAt,
  };
}

function mapUIComponentFromDb(component: typeof agentUIComponents.$inferSelect): AgentUIComponent {
  return {
    id: component.id,
    agentId: component.agentId,
    name: component.name,
    componentType: component.componentType as AgentUIComponent["componentType"],
    code: component.code ?? undefined,
    propsSchema: component.propsSchema ?? undefined,
    styles: component.stylesJson ?? undefined,
    createdAt: component.createdAt,
    updatedAt: component.updatedAt,
  };
}

// ============================================================================
// Register IPC Handlers
// ============================================================================

export function registerAgentBuilderHandlers(): void {
  // Agent CRUD
  ipcMain.handle("agent:create", handleCreateAgent);
  ipcMain.handle("agent:get", handleGetAgent);
  ipcMain.handle("agent:list", handleListAgents);
  ipcMain.handle("agent:update", handleUpdateAgent);
  ipcMain.handle("agent:delete", handleDeleteAgent);
  ipcMain.handle("agent:duplicate", handleDuplicateAgent);

  // Agent Tools
  ipcMain.handle("agent:tool:create", handleCreateAgentTool);
  ipcMain.handle("agent:tool:list", handleGetAgentTools);
  ipcMain.handle("agent:tool:update", handleUpdateAgentTool);
  ipcMain.handle("agent:tool:delete", handleDeleteAgentTool);

  // Agent Workflows
  ipcMain.handle("agent:workflow:create", handleCreateAgentWorkflow);
  ipcMain.handle("agent:workflow:list", handleGetAgentWorkflows);
  ipcMain.handle("agent:workflow:update", handleUpdateAgentWorkflow);
  ipcMain.handle("agent:workflow:delete", handleDeleteAgentWorkflow);

  // Agent Deployments
  ipcMain.handle("agent:deploy", handleDeployAgent);
  ipcMain.handle("agent:deployment:list", handleGetAgentDeployments);
  ipcMain.handle("agent:deployment:stop", handleStopDeployment);

  // Agent Test Sessions
  ipcMain.handle("agent:test:create", handleCreateTestSession);
  ipcMain.handle("agent:test:list", handleGetTestSessions);

  // Agent Knowledge Bases
  ipcMain.handle("agent:kb:create", handleCreateKnowledgeBase);
  ipcMain.handle("agent:kb:list", handleGetKnowledgeBases);

  // Agent UI Components
  ipcMain.handle("agent:ui:create", handleCreateUIComponent);
  ipcMain.handle("agent:ui:list", handleGetUIComponents);

  logger.info("Agent builder IPC handlers registered");
}
