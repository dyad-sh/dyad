/**
 * Agent Stack Handlers
 * IPC handlers for agent triggers, tool catalog management,
 * and end-to-end agent stack building with n8n integration.
 */

import { IpcMainInvokeEvent, ipcMain } from "electron";
import log from "electron-log";
import { randomUUID } from "node:crypto";

import { db } from "@/db";
import { agentTools, agents } from "@/db/schema";
import { eq } from "drizzle-orm";

import {
  createWorkflow,
  activateWorkflow,
  isN8nRunning,
} from "@/ipc/handlers/n8n_handlers";

import type {
  AgentTrigger,
  CreateTriggerRequest,
  UpdateTriggerRequest,
  TriggerConfig,
  TriggerType,
} from "@/types/agent_triggers";

import type {
  CatalogTool,
} from "@/types/agent_tool_catalog";

import {
  AGENT_TOOL_CATALOG,
  getToolById,
} from "@/types/agent_tool_catalog";

import type { N8nWorkflow, N8nNode, N8nConnections } from "@/types/n8n_types";

const logger = log.scope("agent_stack");

// ============================================================================
// In-Memory Trigger Store (persisted via agent config)
// ============================================================================

const triggerStore = new Map<string, AgentTrigger>();

// ============================================================================
// Trigger CRUD Handlers
// ============================================================================

async function handleCreateTrigger(
  _event: IpcMainInvokeEvent,
  request: CreateTriggerRequest
): Promise<AgentTrigger> {
  const trigger: AgentTrigger = {
    id: randomUUID(),
    agentId: request.agentId,
    name: request.name,
    description: request.description,
    type: request.type,
    config: request.config,
    status: "draft",
    triggerCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  triggerStore.set(trigger.id, trigger);
  logger.info(`Created trigger ${trigger.id} (${trigger.type}) for agent ${trigger.agentId}`);

  // Try to create corresponding n8n workflow node
  if (isN8nRunning()) {
    try {
      const n8nWorkflow = buildTriggerWorkflow(trigger);
      const result = await createWorkflow(n8nWorkflow);
      if (result?.id) {
        trigger.n8nWorkflowId = result.id;
        triggerStore.set(trigger.id, trigger);
        logger.info(`Synced trigger ${trigger.id} to n8n workflow ${result.id}`);
      }
    } catch (error) {
      logger.warn(`Could not sync trigger to n8n: ${error}`);
    }
  }

  return trigger;
}

async function handleListTriggers(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<AgentTrigger[]> {
  return Array.from(triggerStore.values()).filter((t) => t.agentId === agentId);
}

async function handleUpdateTrigger(
  _event: IpcMainInvokeEvent,
  request: UpdateTriggerRequest
): Promise<AgentTrigger> {
  const trigger = triggerStore.get(request.id);
  if (!trigger) {
    throw new Error(`Trigger ${request.id} not found`);
  }

  if (request.name !== undefined) trigger.name = request.name;
  if (request.description !== undefined) trigger.description = request.description;
  if (request.config !== undefined) {
    trigger.config = { ...trigger.config, ...request.config } as TriggerConfig;
  }
  if (request.status !== undefined) trigger.status = request.status;
  trigger.updatedAt = Date.now();

  triggerStore.set(trigger.id, trigger);
  logger.info(`Updated trigger ${trigger.id}`);
  return trigger;
}

async function handleDeleteTrigger(
  _event: IpcMainInvokeEvent,
  triggerId: string
): Promise<void> {
  triggerStore.delete(triggerId);
  logger.info(`Deleted trigger ${triggerId}`);
}

async function handleActivateTrigger(
  _event: IpcMainInvokeEvent,
  triggerId: string
): Promise<AgentTrigger> {
  const trigger = triggerStore.get(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);

  trigger.status = "active";
  trigger.updatedAt = Date.now();

  // Activate corresponding n8n workflow
  if (trigger.n8nWorkflowId && isN8nRunning()) {
    try {
      await activateWorkflow(trigger.n8nWorkflowId);
    } catch (error) {
      logger.warn(`Could not activate n8n workflow: ${error}`);
    }
  }

  triggerStore.set(trigger.id, trigger);
  return trigger;
}

async function handlePauseTrigger(
  _event: IpcMainInvokeEvent,
  triggerId: string
): Promise<AgentTrigger> {
  const trigger = triggerStore.get(triggerId);
  if (!trigger) throw new Error(`Trigger ${triggerId} not found`);

  trigger.status = "paused";
  trigger.updatedAt = Date.now();
  triggerStore.set(trigger.id, trigger);
  return trigger;
}

// ============================================================================
// Tool Catalog Handlers
// ============================================================================

async function handleGetToolCatalog(): Promise<CatalogTool[]> {
  return AGENT_TOOL_CATALOG;
}

async function handleGetToolCatalogByCategory(
  _event: IpcMainInvokeEvent,
  category: string
): Promise<CatalogTool[]> {
  return AGENT_TOOL_CATALOG.filter((t) => t.category === category);
}

async function handleSearchToolCatalog(
  _event: IpcMainInvokeEvent,
  query: string
): Promise<CatalogTool[]> {
  const q = query.toLowerCase();
  return AGENT_TOOL_CATALOG.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.includes(q))
  );
}

async function handleAddToolFromCatalog(
  _event: IpcMainInvokeEvent,
  agentId: number,
  catalogToolId: string
): Promise<unknown> {
  const catalogTool = getToolById(catalogToolId);
  if (!catalogTool) {
    throw new Error(`Catalog tool ${catalogToolId} not found`);
  }

  // Insert into agent_tools table
  const [inserted] = await db
    .insert(agentTools)
    .values({
      agentId,
      name: catalogTool.name,
      description: catalogTool.description,
      inputSchema: JSON.parse(JSON.stringify(catalogTool.inputSchema)) as Record<string, unknown>,
      requiresApproval: catalogTool.requiresApproval,
      enabled: true,
    })
    .returning();

  logger.info(`Added catalog tool "${catalogTool.name}" to agent ${agentId}`);
  return inserted;
}

// ============================================================================
// Agent Stack Builder (End-to-End)
// ============================================================================

interface BuildAgentStackRequest {
  agentId: number;
  description: string;
  triggers: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
  toolIds: string[];
  knowledgeFiles?: string[];
  syncToN8n: boolean;
}

interface BuildAgentStackResult {
  success: boolean;
  n8nWorkflowId?: string;
  triggerIds: string[];
  toolIds: string[];
  errors?: string[];
}

async function handleBuildAgentStack(
  _event: IpcMainInvokeEvent,
  request: BuildAgentStackRequest
): Promise<BuildAgentStackResult> {
  const errors: string[] = [];
  const triggerIds: string[] = [];
  const toolIds: string[] = [];

  logger.info(
    `Building agent stack for agent ${request.agentId}: ` +
    `${request.triggers.length} triggers, ${request.toolIds.length} tools`
  );

  // 1. Create triggers
  for (const triggerDef of request.triggers) {
    try {
      const trigger = await handleCreateTrigger(_event, {
        agentId: request.agentId,
        name: `${triggerDef.type} trigger`,
        type: triggerDef.type as TriggerType,
        config: { type: triggerDef.type, ...triggerDef.config } as TriggerConfig,
      });
      triggerIds.push(trigger.id);
    } catch (error) {
      errors.push(`Failed to create ${triggerDef.type} trigger: ${String(error)}`);
    }
  }

  // 2. Add tools from catalog
  for (const toolId of request.toolIds) {
    try {
      await handleAddToolFromCatalog(_event, request.agentId, toolId);
      toolIds.push(toolId);
    } catch (error) {
      errors.push(`Failed to add tool ${toolId}: ${String(error)}`);
    }
  }

  // 3. Sync to n8n if requested
  let n8nWorkflowId: string | undefined;
  if (request.syncToN8n && isN8nRunning()) {
    try {
      const result = await buildAndSyncN8nWorkflow(request.agentId, triggerIds, toolIds);
      n8nWorkflowId = result.id;
    } catch (error) {
      errors.push(`Failed to sync to n8n: ${String(error)}`);
    }
  }

  return {
    success: errors.length === 0,
    n8nWorkflowId,
    triggerIds,
    toolIds,
    errors: errors.length > 0 ? errors : undefined,
  };
}

async function handleGetAgentStack(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<unknown> {
  // Get triggers
  const triggers = Array.from(triggerStore.values())
    .filter((t) => t.agentId === agentId)
    .map((t) => ({
      id: t.id,
      type: t.type,
      name: t.name,
      status: t.status,
      n8nNodeType: getTriggerN8nNodeType(t.type),
    }));

  // Get tools from DB
  const toolRows = await db.query.agentTools.findMany({
    where: eq(agentTools.agentId, agentId),
  });

  const tools = toolRows.map((t) => ({
    id: String(t.id),
    name: t.name,
    category: findToolCategory(t.name),
    enabled: Boolean(t.enabled),
  }));

  return {
    agentId,
    triggers,
    tools,
    knowledgeBases: [],
    n8nWorkflow: undefined,
  };
}

async function handleSyncStackToN8n(
  _event: IpcMainInvokeEvent,
  agentId: number
): Promise<{ success: boolean; n8nWorkflowId?: string; error?: string }> {
  if (!isN8nRunning()) {
    return { success: false, error: "n8n is not running. Start n8n first." };
  }

  try {
    const triggers = Array.from(triggerStore.values())
      .filter((t) => t.agentId === agentId)
      .map((t) => t.id);

    const toolRows = await db.query.agentTools.findMany({
      where: eq(agentTools.agentId, agentId),
    });
    const toolIds = toolRows
      .map((t) => {
        const catalogEntry = AGENT_TOOL_CATALOG.find((c) => c.name === t.name);
        return catalogEntry?.id;
      })
      .filter(Boolean) as string[];

    const result = await buildAndSyncN8nWorkflow(agentId, triggers, toolIds);
    return { success: true, n8nWorkflowId: result.id };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// n8n Workflow Builders
// ============================================================================

function getTriggerN8nNodeType(triggerType: TriggerType): string {
  const mapping: Record<TriggerType, string> = {
    gmail: "n8n-nodes-base.gmailTrigger",
    slack: "n8n-nodes-base.slackTrigger",
    "google-sheets": "n8n-nodes-base.googleSheetsTrigger",
    webhook: "n8n-nodes-base.webhook",
    schedule: "n8n-nodes-base.scheduleTrigger",
    calendar: "n8n-nodes-base.googleCalendarTrigger",
    discord: "n8n-nodes-base.discordTrigger",
    telegram: "n8n-nodes-base.telegramTrigger",
    manual: "n8n-nodes-base.manualTrigger",
  };
  return mapping[triggerType] || "n8n-nodes-base.manualTrigger";
}

function buildTriggerWorkflow(trigger: AgentTrigger): N8nWorkflow {
  const nodeType = getTriggerN8nNodeType(trigger.type);

  const triggerNode: N8nNode = {
    id: randomUUID(),
    name: trigger.name || `${trigger.type} Trigger`,
    type: nodeType,
    typeVersion: 1,
    position: [250, 300],
    parameters: buildTriggerParameters(trigger),
  };

  const processNode: N8nNode = {
    id: randomUUID(),
    name: "Process Trigger",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [500, 300],
    parameters: {
      jsCode: `// Process the trigger event for agent ${trigger.agentId}\nconst items = $input.all();\nreturn items;`,
    },
  };

  const webhookNode: N8nNode = {
    id: randomUUID(),
    name: "Notify Agent",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4,
    position: [750, 300],
    parameters: {
      method: "POST",
      url: "http://localhost:3000/api/agent/trigger-event",
      sendBody: true,
      bodyParameters: {
        parameters: [
          { name: "triggerId", value: trigger.id },
          { name: "agentId", value: String(trigger.agentId) },
          { name: "type", value: trigger.type },
        ],
      },
    },
  };

  const connections: N8nConnections = {
    [triggerNode.name]: {
      main: [[{ node: processNode.name, type: "main", index: 0 }]],
    },
    [processNode.name]: {
      main: [[{ node: webhookNode.name, type: "main", index: 0 }]],
    },
  };

  return {
    name: `Agent ${trigger.agentId} - ${trigger.name}`,
    active: false,
    nodes: [triggerNode, processNode, webhookNode],
    connections,
    settings: { executionOrder: "v1" },
  };
}

function buildTriggerParameters(trigger: AgentTrigger): Record<string, unknown> {
  const config = trigger.config;
  switch (config.type) {
    case "gmail":
      return {
        pollTimes: { item: [{ mode: "everyMinute" }] },
        filters: {
          readStatus: config.unreadOnly ? "unread" : "all",
          sender: config.from || "",
          subject: config.subjectPattern || "",
        },
      };
    case "slack":
      return {
        channel: config.channel || "",
        events: [
          ...(config.onMessage ? ["message"] : []),
          ...(config.onMention ? ["app_mention"] : []),
          ...(config.onReaction ? ["reaction_added"] : []),
        ],
      };
    case "google-sheets":
      return {
        sheetId: config.spreadsheetId,
        sheetName: config.sheetName || "Sheet1",
        event: config.onRowAdded ? "rowAdded" : "sheetUpdated",
      };
    case "webhook":
      return {
        httpMethod: config.method,
        path: config.path || randomUUID(),
        responseMode: config.responseMode,
      };
    case "schedule":
      return {
        rule: { cronExpression: config.cronExpression },
        timezone: config.timezone || "UTC",
      };
    case "manual":
    default:
      return {};
  }
}

async function buildAndSyncN8nWorkflow(
  agentId: number,
  triggerIds: string[],
  toolIds: string[]
): Promise<{ id?: string }> {
  const nodes: N8nNode[] = [];
  const connections: N8nConnections = {};
  let yPos = 300;
  let prevNodeName: string | undefined;

  // Build trigger nodes
  for (const triggerId of triggerIds) {
    const trigger = triggerStore.get(triggerId);
    if (!trigger) continue;

    const nodeType = getTriggerN8nNodeType(trigger.type);
    const nodeName = `Trigger: ${trigger.name}`;
    const node: N8nNode = {
      id: randomUUID(),
      name: nodeName,
      type: nodeType,
      typeVersion: 1,
      position: [250, yPos],
      parameters: buildTriggerParameters(trigger),
    };
    nodes.push(node);

    if (prevNodeName) {
      // Merge triggers
    }
    prevNodeName = nodeName;
    yPos += 150;
  }

  // Add a merge node if multiple triggers
  if (nodes.length > 1) {
    const mergeNode: N8nNode = {
      id: randomUUID(),
      name: "Merge Triggers",
      type: "n8n-nodes-base.merge",
      typeVersion: 2,
      position: [500, 300],
      parameters: { mode: "append" },
    };
    nodes.push(mergeNode);

    for (const triggerNode of nodes.slice(0, -1)) {
      connections[triggerNode.name] = {
        main: [[{ node: "Merge Triggers", type: "main", index: 0 }]],
      };
    }
    prevNodeName = "Merge Triggers";
  }

  // Add AI Agent node
  const agentNode: N8nNode = {
    id: randomUUID(),
    name: "AI Agent",
    type: "@n8n/n8n-nodes-langchain.agent",
    typeVersion: 1,
    position: [750, 300],
    parameters: {
      agentId: String(agentId),
      text: "={{ $json.message || $json.content || JSON.stringify($json) }}",
    },
  };
  nodes.push(agentNode);

  if (prevNodeName) {
    connections[prevNodeName] = {
      main: [[{ node: "AI Agent", type: "main", index: 0 }]],
    };
  }

  // Add tool nodes
  let toolXPos = 1000;
  for (const toolId of toolIds) {
    const catalogTool = getToolById(toolId);
    if (!catalogTool || !catalogTool.n8nNodeType) continue;

    const toolNode: N8nNode = {
      id: randomUUID(),
      name: `Tool: ${catalogTool.name}`,
      type: catalogTool.n8nNodeType,
      typeVersion: 1,
      position: [toolXPos, 500],
      parameters: catalogTool.defaultParams || {},
    };
    nodes.push(toolNode);

    connections["AI Agent"] = connections["AI Agent"] || { main: [] };
    if (!connections["AI Agent"].main[0]) {
      connections["AI Agent"].main[0] = [];
    }
    connections["AI Agent"].main[0].push({
      node: toolNode.name,
      type: "main",
      index: 0,
    });

    toolXPos += 250;
  }

  // Add output node
  const outputNode: N8nNode = {
    id: randomUUID(),
    name: "Output",
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1,
    position: [1250, 300],
    parameters: {
      respondWith: "json",
    },
  };
  nodes.push(outputNode);

  // Connect agent to output
  if (!connections["AI Agent"]) {
    connections["AI Agent"] = { main: [[]] };
  }
  connections["AI Agent"].main[0] = connections["AI Agent"].main[0] || [];
  connections["AI Agent"].main[0].push({
    node: "Output",
    type: "main",
    index: 0,
  });

  const workflow: N8nWorkflow = {
    name: `Agent ${agentId} Stack`,
    active: false,
    nodes,
    connections,
    settings: { executionOrder: "v1" },
  };

  const created = await createWorkflow(workflow);
  return { id: created?.id };
}

function findToolCategory(toolName: string): string {
  const found = AGENT_TOOL_CATALOG.find((t) => t.name === toolName);
  return found?.category || "custom";
}

// ============================================================================
// Register Handlers
// ============================================================================

export function registerAgentStackHandlers(): void {
  // Trigger CRUD
  ipcMain.handle("agent:trigger:create", handleCreateTrigger);
  ipcMain.handle("agent:trigger:list", handleListTriggers);
  ipcMain.handle("agent:trigger:update", handleUpdateTrigger);
  ipcMain.handle("agent:trigger:delete", handleDeleteTrigger);
  ipcMain.handle("agent:trigger:activate", handleActivateTrigger);
  ipcMain.handle("agent:trigger:pause", handlePauseTrigger);

  // Tool catalog
  ipcMain.handle("agent:tool-catalog:list", handleGetToolCatalog);
  ipcMain.handle("agent:tool-catalog:by-category", handleGetToolCatalogByCategory);
  ipcMain.handle("agent:tool-catalog:search", handleSearchToolCatalog);
  ipcMain.handle("agent:tool-catalog:add", handleAddToolFromCatalog);

  // Agent stack builder
  ipcMain.handle("agent:stack:build", handleBuildAgentStack);
  ipcMain.handle("agent:stack:get", handleGetAgentStack);
  ipcMain.handle("agent:stack:sync-n8n", handleSyncStackToN8n);

  logger.info("Agent stack handlers registered");
}
