/**
 * Agent Auto-Setup
 *
 * Orchestrates the full agent creation pipeline from an AgentBlueprint.
 * Creates the agent in the DB, sets up tools, triggers, knowledge bases,
 * UI components, and optionally generates an n8n workflow.
 *
 * This runs on the RENDERER side and calls IPC methods.
 */

import type { Agent } from "@/types/agent_builder";
import { agentBuilderClient } from "@/ipc/agent_builder_client";
import type {
  AgentBlueprint,
  BlueprintTool,
  BlueprintKnowledgeSource,
  BlueprintTrigger,
  BlueprintUIComponent,
  BlueprintWorkflow,
} from "./agent_blueprint_generator";
import { blueprintToCreateRequest } from "./agent_blueprint_generator";

// =============================================================================
// TYPES
// =============================================================================

export interface AutoSetupProgress {
  step: AutoSetupStep;
  status: "pending" | "running" | "completed" | "failed";
  message: string;
  error?: string;
}

export type AutoSetupStep =
  | "create-agent"
  | "setup-tools"
  | "setup-triggers"
  | "setup-knowledge"
  | "setup-ui"
  | "setup-workflow"
  | "configure-model"
  | "finalize";

export interface AutoSetupResult {
  success: boolean;
  agent: Agent | null;
  agentId: number | null;
  steps: AutoSetupProgress[];
  errors: string[];
}

export type ProgressCallback = (progress: AutoSetupProgress) => void;

// =============================================================================
// MAIN AUTO-SETUP FUNCTION
// =============================================================================

/**
 * Execute full agent auto-setup from a blueprint.
 * Creates agent, tools, triggers, knowledge, UI, workflow — in order.
 *
 * @param blueprint - The complete agent blueprint
 * @param onProgress - Optional callback for step-by-step progress updates
 * @returns The setup result with the created agent
 */
export async function autoSetupAgent(
  blueprint: AgentBlueprint,
  onProgress?: ProgressCallback,
): Promise<AutoSetupResult> {
  const steps: AutoSetupProgress[] = [];
  const errors: string[] = [];
  let agent: Agent | null = null;

  const report = (step: AutoSetupStep, status: AutoSetupProgress["status"], message: string, error?: string) => {
    const progress: AutoSetupProgress = { step, status, message, error };
    // Update or add step
    const idx = steps.findIndex((s) => s.step === step);
    if (idx >= 0) {
      steps[idx] = progress;
    } else {
      steps.push(progress);
    }
    onProgress?.(progress);
  };

  try {
    // =========================================================================
    // Step 1: Create the agent
    // =========================================================================
    report("create-agent", "running", "Creating agent...");
    try {
      const request = blueprintToCreateRequest(blueprint);
      agent = await agentBuilderClient.createAgent(request);
      report("create-agent", "completed", `Agent "${agent.name}" created (ID: ${agent.id})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report("create-agent", "failed", "Failed to create agent", msg);
      errors.push(`Create agent: ${msg}`);
      return { success: false, agent: null, agentId: null, steps, errors };
    }

    const agentId = agent.id;

    // =========================================================================
    // Step 2: Set up tools
    // =========================================================================
    report("setup-tools", "running", `Setting up ${blueprint.tools.length} tools...`);
    try {
      await setupTools(agentId, blueprint.tools);
      report("setup-tools", "completed", `${blueprint.tools.length} tools configured`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report("setup-tools", "failed", "Failed to set up tools", msg);
      errors.push(`Setup tools: ${msg}`);
    }

    // =========================================================================
    // Step 3: Set up triggers
    // =========================================================================
    report("setup-triggers", "running", `Setting up ${blueprint.triggers.length} triggers...`);
    try {
      await setupTriggers(agentId, blueprint.triggers);
      report("setup-triggers", "completed", `${blueprint.triggers.length} triggers configured`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report("setup-triggers", "failed", "Failed to set up triggers", msg);
      errors.push(`Setup triggers: ${msg}`);
    }

    // =========================================================================
    // Step 4: Set up knowledge bases
    // =========================================================================
    report("setup-knowledge", "running", `Setting up ${blueprint.knowledgeSources.length} knowledge sources...`);
    try {
      await setupKnowledge(agentId, blueprint.knowledgeSources);
      report("setup-knowledge", "completed", `${blueprint.knowledgeSources.length} knowledge sources configured`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report("setup-knowledge", "failed", "Failed to set up knowledge", msg);
      errors.push(`Setup knowledge: ${msg}`);
    }

    // =========================================================================
    // Step 5: Set up UI components
    // =========================================================================
    report("setup-ui", "running", `Setting up ${blueprint.uiComponents.length} UI components...`);
    try {
      await setupUIComponents(agentId, blueprint.uiComponents);
      report("setup-ui", "completed", `${blueprint.uiComponents.length} UI components configured`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report("setup-ui", "failed", "Failed to set up UI", msg);
      errors.push(`Setup UI: ${msg}`);
    }

    // =========================================================================
    // Step 6: Set up workflow (if any)
    // =========================================================================
    if (blueprint.workflow) {
      report("setup-workflow", "running", "Setting up workflow...");
      try {
        await setupWorkflow(agentId, blueprint.workflow);
        report("setup-workflow", "completed", "Workflow configured");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report("setup-workflow", "failed", "Failed to set up workflow", msg);
        errors.push(`Setup workflow: ${msg}`);
      }
    }

    // =========================================================================
    // Step 7: Configure model settings
    // =========================================================================
    report("configure-model", "running", "Configuring model settings...");
    try {
      await agentBuilderClient.updateAgent({
        id: agentId,
        modelId: blueprint.modelId,
        temperature: blueprint.temperature,
        maxTokens: blueprint.maxTokens,
        config: blueprint.config,
      });
      report("configure-model", "completed", `Model ${blueprint.modelId} configured`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report("configure-model", "failed", "Failed to configure model", msg);
      errors.push(`Configure model: ${msg}`);
    }

    // =========================================================================
    // Step 8: Finalize
    // =========================================================================
    report("finalize", "running", "Finalizing agent setup...");
    try {
      // Set agent to draft status (ready for testing)
      await agentBuilderClient.updateAgent({
        id: agentId,
        status: "draft",
      });
      report("finalize", "completed", "Agent setup complete — ready for testing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report("finalize", "failed", "Failed to finalize", msg);
      errors.push(`Finalize: ${msg}`);
    }

    return {
      success: errors.length === 0,
      agent,
      agentId,
      steps,
      errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Unexpected error: ${msg}`);
    return { success: false, agent, agentId: agent?.id ?? null, steps, errors };
  }
}

// =============================================================================
// STEP IMPLEMENTATIONS
// =============================================================================

async function setupTools(agentId: number, tools: BlueprintTool[]): Promise<void> {
  for (const tool of tools) {
    if (!tool.enabled) continue;
    await agentBuilderClient.createAgentTool({
      agentId,
      name: tool.name,
      description: tool.description,
      requiresApproval: tool.requiresApproval,
    });
  }
}

async function setupTriggers(agentId: number, triggers: BlueprintTrigger[]): Promise<void> {
  // Triggers are stored as part of the agent config custom field
  // since there's no dedicated triggers table yet
  const triggerConfigs = triggers.map((t) => ({
    type: t.type,
    name: t.name,
    description: t.description,
    config: t.config || {},
    enabled: true,
  }));

  await agentBuilderClient.updateAgent({
    id: agentId,
    config: {
      custom: {
        triggers: triggerConfigs,
      },
    },
  });
}

async function setupKnowledge(
  agentId: number,
  sources: BlueprintKnowledgeSource[],
): Promise<void> {
  for (const source of sources) {
    await agentBuilderClient.createKnowledgeBase(
      agentId,
      source.name,
      source.type,
      {
        description: source.description,
        ...source.config,
      },
    );
  }
}

async function setupUIComponents(
  agentId: number,
  components: BlueprintUIComponent[],
): Promise<void> {
  for (const comp of components) {
    await agentBuilderClient.createUIComponent(
      agentId,
      comp.name,
      comp.componentType,
    );
  }
}

async function setupWorkflow(
  agentId: number,
  workflow: BlueprintWorkflow,
): Promise<void> {
  const agentWorkflow = await agentBuilderClient.createAgentWorkflow(
    agentId,
    workflow.name,
    workflow.description,
  );

  // Update workflow with the step definitions
  const definition = {
    nodes: workflow.steps.map((step, idx) => ({
      id: `node_${idx}`,
      type: step.type,
      name: step.name,
      position: { x: 100, y: 100 + idx * 150 },
      config: {
        ...step.config,
      },
    })),
    edges: workflow.steps.slice(0, -1).map((_, idx) => ({
      id: `edge_${idx}`,
      sourceId: `node_${idx}`,
      targetId: `node_${idx + 1}`,
    })),
    entryNodeId: "node_0",
  };

  await agentBuilderClient.updateAgentWorkflow(agentWorkflow.id, {
    definition,
  });
}
