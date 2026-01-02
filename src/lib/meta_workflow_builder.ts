/**
 * Meta Workflow Builder System
 * Enables agents to create, share, and collaborate on workflows
 */

import type {
  N8nWorkflow,
  N8nNode,
  N8nConnections,
  AgentMessage,
  MetaWorkflowConfig,
  WorkflowTemplate,
} from "@/types/n8n_types";

// ============================================================================
// Workflow Template Library
// ============================================================================

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "data-pipeline",
    name: "Data Pipeline",
    description: "Fetch, transform, and store data",
    category: "data",
    nodes: [
      { type: "n8n-nodes-base.httpRequest", name: "Fetch Data", position: [250, 300] },
      { type: "n8n-nodes-base.code", name: "Transform", position: [450, 300] },
      { type: "n8n-nodes-base.postgres", name: "Store", position: [650, 300] },
    ],
    connections: {
      "Fetch Data": { main: [[{ node: "Transform", type: "main", index: 0 }]] },
      "Transform": { main: [[{ node: "Store", type: "main", index: 0 }]] },
    },
    variables: ["apiUrl", "tableName"],
  },
  {
    id: "ai-assistant",
    name: "AI Assistant Pipeline",
    description: "Process input with AI and respond",
    category: "ai",
    nodes: [
      { type: "n8n-nodes-base.webhook", name: "Input", position: [250, 300] },
      { type: "n8n-nodes-base.openAi", name: "AI Process", position: [450, 300] },
      { type: "n8n-nodes-base.respondToWebhook", name: "Respond", position: [650, 300] },
    ],
    connections: {
      "Input": { main: [[{ node: "AI Process", type: "main", index: 0 }]] },
      "AI Process": { main: [[{ node: "Respond", type: "main", index: 0 }]] },
    },
    variables: ["model", "systemPrompt"],
  },
  {
    id: "notification-hub",
    name: "Multi-Channel Notification",
    description: "Send notifications to multiple channels",
    category: "notification",
    nodes: [
      { type: "n8n-nodes-base.webhook", name: "Trigger", position: [250, 300] },
      { type: "n8n-nodes-base.slack", name: "Slack", position: [450, 200] },
      { type: "n8n-nodes-base.emailSend", name: "Email", position: [450, 400] },
    ],
    connections: {
      "Trigger": {
        main: [
          [{ node: "Slack", type: "main", index: 0 }],
          [{ node: "Email", type: "main", index: 0 }],
        ],
      },
    },
    variables: ["slackChannel", "emailRecipient"],
  },
  {
    id: "error-handler",
    name: "Error Handling Pipeline",
    description: "Catch and handle errors gracefully",
    category: "utility",
    nodes: [
      { type: "n8n-nodes-base.errorTrigger", name: "On Error", position: [250, 300] },
      { type: "n8n-nodes-base.code", name: "Log Error", position: [450, 300] },
      { type: "n8n-nodes-base.slack", name: "Alert", position: [650, 300] },
    ],
    connections: {
      "On Error": { main: [[{ node: "Log Error", type: "main", index: 0 }]] },
      "Log Error": { main: [[{ node: "Alert", type: "main", index: 0 }]] },
    },
    variables: ["alertChannel"],
  },
  {
    id: "agent-communicator",
    name: "Agent Communication Hub",
    description: "Enable agents to send messages to each other",
    category: "agent",
    nodes: [
      { type: "n8n-nodes-base.webhook", name: "Receive Message", position: [250, 300] },
      { type: "n8n-nodes-base.switch", name: "Route", position: [450, 300] },
      { type: "n8n-nodes-base.httpRequest", name: "Send to Agent A", position: [650, 200] },
      { type: "n8n-nodes-base.httpRequest", name: "Send to Agent B", position: [650, 400] },
    ],
    connections: {
      "Receive Message": { main: [[{ node: "Route", type: "main", index: 0 }]] },
      "Route": {
        main: [
          [{ node: "Send to Agent A", type: "main", index: 0 }],
          [{ node: "Send to Agent B", type: "main", index: 0 }],
        ],
      },
    },
    variables: ["agentAUrl", "agentBUrl"],
  },
  {
    id: "workflow-builder",
    name: "Dynamic Workflow Builder",
    description: "Create new workflows from templates",
    category: "meta",
    nodes: [
      { type: "n8n-nodes-base.webhook", name: "Build Request", position: [250, 300] },
      { type: "n8n-nodes-base.openAi", name: "Design Workflow", position: [450, 300] },
      { type: "n8n-nodes-base.code", name: "Parse & Validate", position: [650, 300] },
      { type: "n8n-nodes-base.n8n", name: "Create Workflow", position: [850, 300] },
      { type: "n8n-nodes-base.respondToWebhook", name: "Return ID", position: [1050, 300] },
    ],
    connections: {
      "Build Request": { main: [[{ node: "Design Workflow", type: "main", index: 0 }]] },
      "Design Workflow": { main: [[{ node: "Parse & Validate", type: "main", index: 0 }]] },
      "Parse & Validate": { main: [[{ node: "Create Workflow", type: "main", index: 0 }]] },
      "Create Workflow": { main: [[{ node: "Return ID", type: "main", index: 0 }]] },
    },
    variables: ["openAiApiKey"],
  },
];

// ============================================================================
// Meta Workflow Builder
// ============================================================================

export class MetaWorkflowBuilder {
  private templates: Map<string, WorkflowTemplate> = new Map();

  constructor() {
    // Load default templates
    for (const template of WORKFLOW_TEMPLATES) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * Create a workflow from a template with customizations
   */
  createFromTemplate(
    templateId: string,
    customization: {
      name: string;
      variables: Record<string, string>;
      additionalNodes?: N8nNode[];
    }
  ): N8nWorkflow | null {
    const template = this.templates.get(templateId);
    if (!template) return null;

    const nodes: N8nNode[] = template.nodes.map((node, index) => ({
      id: this.generateId(),
      name: node.name,
      type: node.type,
      typeVersion: 1,
      position: node.position,
      parameters: this.applyVariables(node.parameters || {}, customization.variables),
    }));

    if (customization.additionalNodes) {
      nodes.push(...customization.additionalNodes);
    }

    return {
      name: customization.name,
      active: false,
      nodes,
      connections: template.connections as N8nConnections,
      settings: { executionOrder: "v1" },
    };
  }

  /**
   * Compose multiple templates into a single workflow
   */
  composeWorkflows(
    name: string,
    templateIds: string[],
    connectionPoints: Array<{ from: string; to: string }>
  ): N8nWorkflow | null {
    const nodes: N8nNode[] = [];
    const connections: N8nConnections = {};
    let xOffset = 250;

    for (const templateId of templateIds) {
      const template = this.templates.get(templateId);
      if (!template) continue;

      // Add nodes with offset positions
      for (const node of template.nodes) {
        nodes.push({
          id: this.generateId(),
          name: `${template.name}_${node.name}`,
          type: node.type,
          typeVersion: 1,
          position: [node.position[0] + xOffset, node.position[1]],
          parameters: node.parameters || {},
        });
      }

      // Add connections with prefixed names
      for (const [source, conns] of Object.entries(template.connections)) {
        const prefixedSource = `${template.name}_${source}`;
        connections[prefixedSource] = {
          main: (conns as { main: Array<Array<{ node: string; type: string; index: number }>> }).main.map(
            (outputs) => outputs.map((conn) => ({
              ...conn,
              node: `${template.name}_${conn.node}`,
            }))
          ),
        };
      }

      xOffset += 400;
    }

    // Add cross-template connections
    for (const { from, to } of connectionPoints) {
      if (!connections[from]) {
        connections[from] = { main: [[]] };
      }
      connections[from].main[0].push({
        node: to,
        type: "main",
        index: 0,
      });
    }

    return {
      name,
      active: false,
      nodes,
      connections,
      settings: { executionOrder: "v1" },
    };
  }

  /**
   * Generate an AI-powered workflow based on natural language
   */
  async generateFromPrompt(
    prompt: string,
    context: {
      availableIntegrations: string[];
      agentCapabilities: string[];
      existingWorkflows: string[];
    }
  ): Promise<{
    workflow: N8nWorkflow;
    explanation: string;
    suggestions: string[];
  }> {
    // Analyze prompt for key requirements
    const requirements = this.analyzePrompt(prompt);
    
    // Select best template or create custom
    const bestTemplate = this.selectBestTemplate(requirements);
    
    // Build the workflow
    const workflow = this.buildWorkflowFromRequirements(requirements, bestTemplate);
    
    return {
      workflow,
      explanation: `Created workflow "${workflow.name}" with ${workflow.nodes.length} nodes based on your requirements.`,
      suggestions: this.generateSuggestions(workflow, context),
    };
  }

  private analyzePrompt(prompt: string): WorkflowRequirements {
    const lower = prompt.toLowerCase();
    
    return {
      needsTrigger: lower.includes("when") || lower.includes("trigger") || lower.includes("schedule"),
      needsAI: lower.includes("ai") || lower.includes("gpt") || lower.includes("analyze") || lower.includes("generate"),
      needsDatabase: lower.includes("database") || lower.includes("store") || lower.includes("save"),
      needsNotification: lower.includes("notify") || lower.includes("alert") || lower.includes("send"),
      needsAPI: lower.includes("api") || lower.includes("fetch") || lower.includes("request"),
      needsTransform: lower.includes("transform") || lower.includes("convert") || lower.includes("process"),
      isAgentTask: lower.includes("agent") || lower.includes("collaborate"),
      isMetaTask: lower.includes("create workflow") || lower.includes("build workflow"),
    };
  }

  private selectBestTemplate(requirements: WorkflowRequirements): WorkflowTemplate | null {
    if (requirements.isMetaTask) {
      return this.templates.get("workflow-builder") || null;
    }
    if (requirements.isAgentTask) {
      return this.templates.get("agent-communicator") || null;
    }
    if (requirements.needsAI) {
      return this.templates.get("ai-assistant") || null;
    }
    if (requirements.needsDatabase && requirements.needsAPI) {
      return this.templates.get("data-pipeline") || null;
    }
    if (requirements.needsNotification) {
      return this.templates.get("notification-hub") || null;
    }
    return null;
  }

  private buildWorkflowFromRequirements(
    requirements: WorkflowRequirements,
    template: WorkflowTemplate | null
  ): N8nWorkflow {
    const nodes: N8nNode[] = [];
    const connections: N8nConnections = {};
    let xPos = 250;
    let prevNodeName = "";

    // Add trigger
    if (requirements.needsTrigger) {
      const triggerNode: N8nNode = {
        id: this.generateId(),
        name: "Trigger",
        type: requirements.isMetaTask 
          ? "n8n-nodes-base.webhook"
          : "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1,
        position: [xPos, 300],
        parameters: {},
      };
      nodes.push(triggerNode);
      prevNodeName = triggerNode.name;
      xPos += 200;
    }

    // Add API fetch
    if (requirements.needsAPI) {
      const apiNode: N8nNode = {
        id: this.generateId(),
        name: "API Request",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4,
        position: [xPos, 300],
        parameters: { method: "GET" },
      };
      nodes.push(apiNode);
      if (prevNodeName) {
        connections[prevNodeName] = { main: [[{ node: apiNode.name, type: "main", index: 0 }]] };
      }
      prevNodeName = apiNode.name;
      xPos += 200;
    }

    // Add AI processing
    if (requirements.needsAI) {
      const aiNode: N8nNode = {
        id: this.generateId(),
        name: "AI Process",
        type: "n8n-nodes-base.openAi",
        typeVersion: 1,
        position: [xPos, 300],
        parameters: { operation: "message" },
      };
      nodes.push(aiNode);
      if (prevNodeName) {
        connections[prevNodeName] = { main: [[{ node: aiNode.name, type: "main", index: 0 }]] };
      }
      prevNodeName = aiNode.name;
      xPos += 200;
    }

    // Add transform
    if (requirements.needsTransform) {
      const transformNode: N8nNode = {
        id: this.generateId(),
        name: "Transform",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [xPos, 300],
        parameters: { language: "javaScript", code: "// Transform data\nreturn $input.all();" },
      };
      nodes.push(transformNode);
      if (prevNodeName) {
        connections[prevNodeName] = { main: [[{ node: transformNode.name, type: "main", index: 0 }]] };
      }
      prevNodeName = transformNode.name;
      xPos += 200;
    }

    // Add database
    if (requirements.needsDatabase) {
      const dbNode: N8nNode = {
        id: this.generateId(),
        name: "Database",
        type: "n8n-nodes-base.postgres",
        typeVersion: 2,
        position: [xPos, 300],
        parameters: { operation: "insert" },
      };
      nodes.push(dbNode);
      if (prevNodeName) {
        connections[prevNodeName] = { main: [[{ node: dbNode.name, type: "main", index: 0 }]] };
      }
      prevNodeName = dbNode.name;
      xPos += 200;
    }

    // Add notification
    if (requirements.needsNotification) {
      const notifyNode: N8nNode = {
        id: this.generateId(),
        name: "Notify",
        type: "n8n-nodes-base.slack",
        typeVersion: 2,
        position: [xPos, 300],
        parameters: { operation: "postMessage" },
      };
      nodes.push(notifyNode);
      if (prevNodeName) {
        connections[prevNodeName] = { main: [[{ node: notifyNode.name, type: "main", index: 0 }]] };
      }
      xPos += 200;
    }

    // Fallback: add at least one node
    if (nodes.length === 0) {
      nodes.push({
        id: this.generateId(),
        name: "Start",
        type: "n8n-nodes-base.manualTrigger",
        typeVersion: 1,
        position: [250, 300],
        parameters: {},
      });
    }

    return {
      name: `Generated Workflow - ${new Date().toISOString().slice(0, 10)}`,
      active: false,
      nodes,
      connections,
      settings: { executionOrder: "v1" },
    };
  }

  private generateSuggestions(
    workflow: N8nWorkflow,
    context: {
      availableIntegrations: string[];
      agentCapabilities: string[];
      existingWorkflows: string[];
    }
  ): string[] {
    const suggestions: string[] = [];
    
    if (!workflow.nodes.some(n => n.type.includes("errorTrigger"))) {
      suggestions.push("Consider adding error handling for robustness");
    }
    
    if (workflow.nodes.length < 3) {
      suggestions.push("This workflow is minimal - you might want to add more processing steps");
    }

    if (context.existingWorkflows.length > 0) {
      suggestions.push(`You have ${context.existingWorkflows.length} existing workflows that might be reusable`);
    }

    return suggestions;
  }

  private applyVariables(
    params: Record<string, unknown>,
    variables: Record<string, string>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string" && value.startsWith("{{") && value.endsWith("}}")) {
        const varName = value.slice(2, -2).trim();
        result[key] = variables[varName] || value;
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  // Template management
  addTemplate(template: WorkflowTemplate): void {
    this.templates.set(template.id, template);
  }

  getTemplate(id: string): WorkflowTemplate | undefined {
    return this.templates.get(id);
  }

  listTemplates(): WorkflowTemplate[] {
    return Array.from(this.templates.values());
  }
}

interface WorkflowRequirements {
  needsTrigger: boolean;
  needsAI: boolean;
  needsDatabase: boolean;
  needsNotification: boolean;
  needsAPI: boolean;
  needsTransform: boolean;
  isAgentTask: boolean;
  isMetaTask: boolean;
}

// ============================================================================
// Agent-to-Agent Communication Protocol
// ============================================================================

export interface AgentCommunicationProtocol {
  version: "1.0";
  messageTypes: {
    TASK_REQUEST: "task-request";
    TASK_RESPONSE: "task-response";
    WORKFLOW_REQUEST: "workflow-request";
    WORKFLOW_SHARE: "workflow-share";
    STATUS_UPDATE: "status-update";
    CAPABILITY_QUERY: "capability-query";
    CAPABILITY_RESPONSE: "capability-response";
  };
}

export const AGENT_PROTOCOL: AgentCommunicationProtocol = {
  version: "1.0",
  messageTypes: {
    TASK_REQUEST: "task-request",
    TASK_RESPONSE: "task-response",
    WORKFLOW_REQUEST: "workflow-request",
    WORKFLOW_SHARE: "workflow-share",
    STATUS_UPDATE: "status-update",
    CAPABILITY_QUERY: "capability-query",
    CAPABILITY_RESPONSE: "capability-response",
  },
};

export function createAgentMessage(
  fromAgentId: number,
  toAgentId: number | "broadcast",
  type: string,
  payload: Record<string, unknown>
): Omit<AgentMessage, "id" | "timestamp" | "status"> {
  return {
    fromAgentId,
    toAgentId,
    type,
    payload,
  };
}

/**
 * Create a workflow request message that one agent sends to another
 */
export function createWorkflowRequestMessage(
  fromAgentId: number,
  toAgentId: number,
  description: string,
  requirements: Record<string, unknown>
): Omit<AgentMessage, "id" | "timestamp" | "status"> {
  return createAgentMessage(
    fromAgentId,
    toAgentId,
    AGENT_PROTOCOL.messageTypes.WORKFLOW_REQUEST,
    {
      description,
      requirements,
      priority: "normal",
    }
  );
}

/**
 * Create a workflow to handle agent-to-agent communication
 */
export function createAgentCommunicationWorkflow(
  agentId: number,
  webhookPath: string
): N8nWorkflow {
  return {
    name: `Agent ${agentId} Communication Hub`,
    active: true,
    nodes: [
      {
        id: "webhook",
        name: "Receive Message",
        type: "n8n-nodes-base.webhook",
        typeVersion: 1,
        position: [250, 300],
        parameters: {
          httpMethod: "POST",
          path: webhookPath,
          responseMode: "responseNode",
        },
      },
      {
        id: "validate",
        name: "Validate Message",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [450, 300],
        parameters: {
          language: "javaScript",
          code: `
// Validate incoming agent message
const msg = $input.first().json;

if (!msg.fromAgentId || !msg.type || !msg.payload) {
  throw new Error('Invalid message format');
}

// Add processing metadata
return [{
  json: {
    ...msg,
    receivedAt: new Date().toISOString(),
    processingAgentId: ${agentId}
  }
}];`,
        },
      },
      {
        id: "router",
        name: "Route by Type",
        type: "n8n-nodes-base.switch",
        typeVersion: 3,
        position: [650, 300],
        parameters: {
          rules: {
            values: [
              {
                conditions: {
                  conditions: [
                    { leftValue: "={{ $json.type }}", operator: { value: "equals" }, rightValue: "task-request" },
                  ],
                },
                output: 0,
              },
              {
                conditions: {
                  conditions: [
                    { leftValue: "={{ $json.type }}", operator: { value: "equals" }, rightValue: "workflow-request" },
                  ],
                },
                output: 1,
              },
              {
                conditions: {
                  conditions: [
                    { leftValue: "={{ $json.type }}", operator: { value: "equals" }, rightValue: "capability-query" },
                  ],
                },
                output: 2,
              },
            ],
          },
        },
      },
      {
        id: "task-handler",
        name: "Handle Task",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [850, 200],
        parameters: {
          language: "javaScript",
          code: `
// Process task request
const task = $input.first().json;

return [{
  json: {
    type: 'task-response',
    toAgentId: task.fromAgentId,
    fromAgentId: ${agentId},
    payload: {
      taskId: task.payload.taskId || 'unknown',
      status: 'received',
      message: 'Task will be processed'
    }
  }
}];`,
        },
      },
      {
        id: "workflow-handler",
        name: "Handle Workflow Request",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4,
        position: [850, 300],
        parameters: {
          method: "POST",
          url: "http://localhost:5678/webhook/build-workflow",
          body: "={{ JSON.stringify($json.payload) }}",
          contentType: "application/json",
        },
      },
      {
        id: "capability-handler",
        name: "Return Capabilities",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [850, 400],
        parameters: {
          language: "javaScript",
          code: `
// Return this agent's capabilities
return [{
  json: {
    type: 'capability-response',
    toAgentId: $input.first().json.fromAgentId,
    fromAgentId: ${agentId},
    payload: {
      capabilities: ['task-execution', 'workflow-creation', 'data-processing'],
      status: 'ready'
    }
  }
}];`,
        },
      },
      {
        id: "respond",
        name: "Respond",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1,
        position: [1050, 300],
        parameters: {
          respondWith: "json",
          responseBody: "={{ $json }}",
        },
      },
    ],
    connections: {
      "Receive Message": {
        main: [[{ node: "Validate Message", type: "main", index: 0 }]],
      },
      "Validate Message": {
        main: [[{ node: "Route by Type", type: "main", index: 0 }]],
      },
      "Route by Type": {
        main: [
          [{ node: "Handle Task", type: "main", index: 0 }],
          [{ node: "Handle Workflow Request", type: "main", index: 0 }],
          [{ node: "Return Capabilities", type: "main", index: 0 }],
        ],
      },
      "Handle Task": {
        main: [[{ node: "Respond", type: "main", index: 0 }]],
      },
      "Handle Workflow Request": {
        main: [[{ node: "Respond", type: "main", index: 0 }]],
      },
      "Return Capabilities": {
        main: [[{ node: "Respond", type: "main", index: 0 }]],
      },
    },
    settings: {
      executionOrder: "v1",
    },
  };
}

// Export singleton instance
export const metaWorkflowBuilder = new MetaWorkflowBuilder();
