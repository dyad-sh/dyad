/**
 * OpenClaw Action Dispatcher
 *
 * Maps action IDs to real JoyCreate IPC handler invocations.
 * This is the bridge that lets the autonomous brain actually DO things
 * across the entire platform.
 *
 * Each action calls the same handler functions that the IPC channels use,
 * but from the main process directly (no round-trip through preload).
 */

import { ipcMain } from "electron";
import log from "electron-log";
import type { ActionDefinition } from "@/types/openclaw_autonomous_types";

const logger = log.scope("openclaw_dispatch");

// ── Action Catalog ─────────────────────────────────────────────────────────
// Every autonomous action the system can perform.
// These map 1:1 to existing IPC channels.

export const ACTION_CATALOG: ActionDefinition[] = [
  // ── App Building ──
  {
    id: "app.create",
    category: "app",
    name: "Create App",
    description: "Create a new app with initial scaffold and chat session",
    parameters: [
      { name: "name", type: "string", required: true, description: "App name" },
    ],
    channel: "create-app",
  },
  {
    id: "app.get",
    category: "app",
    name: "Get App",
    description: "Get details of an app by its ID",
    parameters: [
      { name: "appId", type: "number", required: true, description: "The app ID" },
    ],
    channel: "get-app",
    positional: true,
  },
  {
    id: "app.list",
    category: "app",
    name: "List Apps",
    description: "List all apps in JoyCreate",
    parameters: [],
    channel: "list-apps",
  },
  {
    id: "app.run",
    category: "app",
    name: "Run App",
    description: "Start running an app in the dev server",
    parameters: [
      { name: "appId", type: "number", required: true, description: "The app ID" },
    ],
    channel: "run-app",
  },
  {
    id: "app.stop",
    category: "app",
    name: "Stop App",
    description: "Stop a running app",
    parameters: [
      { name: "appId", type: "number", required: true, description: "The app ID" },
    ],
    channel: "stop-app",
  },
  {
    id: "app.read_file",
    category: "app",
    name: "Read App File",
    description: "Read the contents of a file in an app",
    parameters: [
      { name: "appId", type: "number", required: true, description: "The app ID" },
      { name: "filePath", type: "string", required: true, description: "Relative file path within the app" },
    ],
    channel: "read-app-file",
  },
  {
    id: "app.create_chat",
    category: "app",
    name: "Create App Chat",
    description: "Create a new chat session for an app to start building",
    parameters: [
      { name: "appId", type: "number", required: true, description: "The app ID" },
    ],
    channel: "create-chat",
    positional: true,
  },
  {
    id: "app.generate_code",
    category: "app",
    name: "Generate Code",
    description: "Send a prompt to generate or modify app code via AI streaming",
    parameters: [
      { name: "chatId", type: "number", required: true, description: "The chat ID" },
      { name: "prompt", type: "string", required: true, description: "The coding prompt" },
    ],
    channel: "chat:stream",
  },

  // ── GitHub ──
  {
    id: "github.create_repo",
    category: "github",
    name: "Create GitHub Repo",
    description: "Create a new GitHub repository for an app",
    parameters: [
      { name: "org", type: "string", required: true, description: "GitHub org or username" },
      { name: "repo", type: "string", required: true, description: "Repository name" },
      { name: "appId", type: "number", required: true, description: "The app ID" },
    ],
    channel: "github:create-repo",
  },
  {
    id: "github.push",
    category: "github",
    name: "Push to GitHub",
    description: "Push app code to the connected GitHub repository",
    parameters: [
      { name: "appId", type: "number", required: true, description: "The app ID" },
    ],
    channel: "github:push",
  },

  // ── Deployment ──
  {
    id: "deploy.auto_deploy",
    category: "deploy",
    name: "Auto Deploy",
    description: "One-click deploy: completeness check → GitHub push → platform deploy",
    parameters: [
      { name: "appId", type: "number", required: true, description: "The app ID" },
      { name: "target", type: "string", required: true, description: "Deploy target: vercel, 4everland, fleek, ipfs-pinata, arweave, spheron" },
    ],
    channel: "deploy:auto-deploy",
  },
  {
    id: "deploy.check_completeness",
    category: "deploy",
    name: "Check Completeness",
    description: "Check if an app is complete and ready for deployment",
    parameters: [
      { name: "appId", type: "number", required: true, description: "The app ID" },
    ],
    channel: "deploy:check-completeness",
  },

  // ── Marketplace ──
  {
    id: "marketplace.publish",
    category: "marketplace",
    name: "Publish to Marketplace",
    description: "Publish an app to JoyMarketplace for others to discover and install",
    parameters: [
      { name: "appId", type: "number", required: true, description: "The app ID" },
      { name: "name", type: "string", required: true, description: "Display name" },
      { name: "description", type: "string", required: true, description: "App description" },
      { name: "category", type: "string", required: true, description: "Asset category" },
    ],
    channel: "marketplace:publish",
  },
  {
    id: "marketplace.browse",
    category: "marketplace",
    name: "Browse Marketplace",
    description: "Search and browse assets on JoyMarketplace",
    parameters: [
      { name: "query", type: "string", required: false, description: "Search query" },
      { name: "category", type: "string", required: false, description: "Filter by category" },
    ],
    channel: "marketplace:browse",
  },
  {
    id: "marketplace.install",
    category: "marketplace",
    name: "Install Marketplace Asset",
    description: "Install an asset from JoyMarketplace",
    parameters: [
      { name: "assetId", type: "string", required: true, description: "The asset ID" },
    ],
    channel: "marketplace:install-asset",
  },

  // ── Agents ──
  {
    id: "agent.create",
    category: "agent",
    name: "Create Agent",
    description: "Create a new AI agent with a specific purpose and tools",
    parameters: [
      { name: "name", type: "string", required: true, description: "Agent name" },
      { name: "description", type: "string", required: false, description: "Agent purpose" },
      { name: "type", type: "string", required: true, description: "Agent type: assistant, coder, researcher, etc." },
      { name: "systemPrompt", type: "string", required: false, description: "System prompt" },
      { name: "templateId", type: "string", required: false, description: "Template ID to base the agent on" },
      { name: "modelId", type: "string", required: false, description: "AI model ID" },
      { name: "appId", type: "number", required: false, description: "App ID to associate the agent with" },
    ],
    channel: "agent:create",
  },
  {
    id: "agent.list",
    category: "agent",
    name: "List Agents",
    description: "List all created agents",
    parameters: [],
    channel: "agent:list",
  },
  {
    id: "agent.deploy",
    category: "agent",
    name: "Deploy Agent",
    description: "Deploy an agent to run autonomously",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:deploy",
  },
  {
    id: "agent.publish",
    category: "agent",
    name: "Publish Agent to Marketplace",
    description: "Publish an agent to JoyMarketplace",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:publish-to-marketplace",
  },

  // ── Workflows (n8n) ──
  {
    id: "workflow.create",
    category: "workflow",
    name: "Create Workflow",
    description: "Create a new n8n automation workflow",
    parameters: [
      { name: "name", type: "string", required: true, description: "Workflow name" },
      { name: "nodes", type: "object", required: false, description: "Workflow node definitions" },
    ],
    channel: "n8n:workflow:create",
  },
  {
    id: "workflow.generate",
    category: "workflow",
    name: "AI Generate Workflow",
    description: "Use AI to generate an n8n workflow from a natural language description",
    parameters: [
      { name: "description", type: "string", required: true, description: "What the workflow should do" },
      { name: "triggerType", type: "string", required: false, description: "Trigger type: manual, schedule, webhook" },
    ],
    channel: "n8n:workflow:generate",
  },
  {
    id: "workflow.execute",
    category: "workflow",
    name: "Execute Workflow",
    description: "Run an existing n8n workflow",
    parameters: [
      { name: "id", type: "string", required: true, description: "Workflow ID" },
      { name: "data", type: "object", required: false, description: "Input data" },
    ],
    channel: "n8n:workflow:execute",
    positional: true,
  },
  {
    id: "workflow.list",
    category: "workflow",
    name: "List Workflows",
    description: "List all n8n workflows",
    parameters: [],
    channel: "n8n:workflow:list",
  },

  // ── Email ──
  {
    id: "email.compose",
    category: "email",
    name: "AI Compose Email",
    description: "Use AI to compose an email based on instructions",
    parameters: [
      { name: "accountId", type: "string", required: true, description: "Email account ID" },
      { name: "instruction", type: "string", required: true, description: "What to write" },
      { name: "to", type: "string", required: false, description: "Recipient" },
      { name: "subject", type: "string", required: false, description: "Subject" },
    ],
    channel: "email:ai:compose",
  },
  {
    id: "email.send",
    category: "email",
    name: "Send Email",
    description: "Send an email from a connected account",
    parameters: [
      { name: "accountId", type: "string", required: true, description: "Email account ID" },
      { name: "to", type: "string", required: true, description: "Recipient" },
      { name: "subject", type: "string", required: true, description: "Subject" },
      { name: "body", type: "string", required: true, description: "Email body" },
    ],
    channel: "email:send",
  },
  {
    id: "email.list_accounts",
    category: "email",
    name: "List Email Accounts",
    description: "List connected email accounts",
    parameters: [],
    channel: "email:account:list",
  },
  {
    id: "email.triage",
    category: "email",
    name: "AI Triage Emails",
    description: "Use AI to triage and categorize emails",
    parameters: [
      { name: "messageIds", type: "object", required: true, description: "Array of message IDs to triage" },
    ],
    channel: "email:ai:triage-batch",
  },
  {
    id: "email.daily_digest",
    category: "email",
    name: "Generate Daily Digest",
    description: "Generate an AI-powered daily email digest",
    parameters: [],
    channel: "email:ai:daily-digest",
  },

  // ── Image Studio ──
  {
    id: "image.generate",
    category: "image",
    name: "Generate Image",
    description: "Generate an AI image from a text prompt",
    parameters: [
      { name: "prompt", type: "string", required: true, description: "Image description" },
      { name: "provider", type: "string", required: false, description: "Provider: openai, google, stability, local" },
      { name: "width", type: "number", required: false, description: "Image width (default 1024)" },
      { name: "height", type: "number", required: false, description: "Image height (default 1024)" },
    ],
    channel: "image-studio:generate",
  },
  {
    id: "image.list",
    category: "image",
    name: "List Generated Images",
    description: "List previously generated images",
    parameters: [],
    channel: "image-studio:list",
  },

  // ── Video Studio ──
  {
    id: "video.generate",
    category: "video",
    name: "Generate Video",
    description: "Generate an AI video from a text prompt",
    parameters: [
      { name: "prompt", type: "string", required: true, description: "Video description" },
      { name: "provider", type: "string", required: false, description: "Provider: runway, stability, local" },
      { name: "duration", type: "number", required: false, description: "Duration in seconds" },
    ],
    channel: "video-studio:generate",
  },

  // ── Web Scraping ──
  {
    id: "scraper.start_job",
    category: "scraper",
    name: "Start Scraping Job",
    description: "Start a web scraping job using a saved configuration",
    parameters: [
      { name: "configId", type: "string", required: true, description: "Scraper config ID" },
    ],
    channel: "scraper:job:start",
    positional: true,
  },
  {
    id: "scraper.list_configs",
    category: "scraper",
    name: "List Scraper Configs",
    description: "List available scraping configurations",
    parameters: [],
    channel: "scraper:config:list",
  },
  {
    id: "scraper.list_datasets",
    category: "scraper",
    name: "List Scraped Datasets",
    description: "List datasets from completed scraping jobs",
    parameters: [],
    channel: "scraper:dataset:list",
  },

  // ── Missions ──
  {
    id: "mission.start",
    category: "mission",
    name: "Start Background Mission",
    description: "Start a long-running autonomous background mission",
    parameters: [
      { name: "title", type: "string", required: true, description: "Mission title" },
      { name: "description", type: "string", required: false, description: "Mission description" },
      { name: "appId", type: "number", required: false, description: "App ID for code missions" },
    ],
    channel: "mission:start",
  },
  {
    id: "mission.list",
    category: "mission",
    name: "List Missions",
    description: "List all background missions and their status",
    parameters: [],
    channel: "mission:list",
  },

  // ── Data Operations ──
  {
    id: "data.search_vector",
    category: "data",
    name: "Vector Search",
    description: "Search the local vector store for similar content (RAG)",
    parameters: [
      { name: "query", type: "string", required: true, description: "Search query" },
      { name: "limit", type: "number", required: false, description: "Max results (default 10)" },
    ],
    channel: "vector:search",
  },

  // ── System ──
  {
    id: "system.n8n_status",
    category: "system",
    name: "Check n8n Status",
    description: "Check if the n8n automation server is running",
    parameters: [],
    channel: "n8n:status",
  },
  {
    id: "system.n8n_start",
    category: "system",
    name: "Start n8n",
    description: "Start the n8n automation server",
    parameters: [],
    channel: "n8n:start",
  },
  {
    id: "system.ollama_status",
    category: "system",
    name: "Check Ollama Status",
    description: "Check if Ollama is running and available",
    parameters: [],
    channel: "cns:ollama:status",
  },

  // ── Skills ──
  {
    id: "skill.list",
    category: "skill",
    name: "List Skills",
    description: "List all available skills",
    parameters: [],
    channel: "skill:list",
  },
  {
    id: "skill.execute",
    category: "skill",
    name: "Execute Skill",
    description: "Run an installed skill by ID with the given input text",
    parameters: [
      { name: "skillId", type: "number", required: true, description: "The skill ID to execute" },
      { name: "input", type: "string", required: true, description: "Input text for the skill" },
    ],
    channel: "skill:execute",
  },
  {
    id: "skill.generate",
    category: "skill",
    name: "Generate Skill",
    description: "Generate a new skill from a plain-English description",
    parameters: [
      { name: "description", type: "string", required: true, description: "Natural language description of the skill" },
    ],
    channel: "skill:generate",
  },
  {
    id: "skill.match",
    category: "skill",
    name: "Match Skill",
    description: "Find the best matching skill for a given text input",
    parameters: [
      { name: "text", type: "string", required: true, description: "Text to match against skill triggers" },
    ],
    channel: "skill:match",
    positional: true,
  },

  // ── Agent Builder ──
  {
    id: "agent_builder.create",
    category: "agent_builder",
    name: "Create Agent (Builder)",
    description: "Create a new AI agent with full configuration (tools, memory, prompts, constraints)",
    parameters: [
      { name: "name", type: "string", required: true, description: "Agent name" },
      { name: "description", type: "string", required: false, description: "Agent description" },
      { name: "type", type: "string", required: false, description: "Agent type: assistant, coder, researcher, analyst, creative, custom" },
    ],
    channel: "agent-builder:create-agent",
  },
  {
    id: "agent_builder.create_from_template",
    category: "agent_builder",
    name: "Create Agent from Template",
    description: "Create a new agent based on a predefined template",
    parameters: [
      { name: "templateId", type: "string", required: true, description: "Template ID to use" },
      { name: "name", type: "string", required: true, description: "New agent name" },
      { name: "description", type: "string", required: false, description: "Override description" },
    ],
    channel: "agent-builder:create-from-template",
  },
  {
    id: "agent_builder.get",
    category: "agent_builder",
    name: "Get Agent (Builder)",
    description: "Get full details of an agent by ID",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
    ],
    channel: "agent-builder:get-agent",
    positional: true,
  },
  {
    id: "agent_builder.list",
    category: "agent_builder",
    name: "List Agents (Builder)",
    description: "List all agents with optional filters (status, type, tags, search)",
    parameters: [
      { name: "status", type: "string", required: false, description: "Filter by status" },
      { name: "type", type: "string", required: false, description: "Filter by type" },
      { name: "search", type: "string", required: false, description: "Search query" },
    ],
    channel: "agent-builder:list-agents",
  },
  {
    id: "agent_builder.delete",
    category: "agent_builder",
    name: "Delete Agent (Builder)",
    description: "Delete an agent by ID",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
    ],
    channel: "agent-builder:delete-agent",
    positional: true,
  },
  {
    id: "agent_builder.activate",
    category: "agent_builder",
    name: "Activate Agent",
    description: "Activate an agent so it can process tasks",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
    ],
    channel: "agent-builder:activate-agent",
    positional: true,
  },
  {
    id: "agent_builder.generate_prompt",
    category: "agent_builder",
    name: "Generate System Prompt",
    description: "Use AI to generate a system prompt for an agent based on its purpose",
    parameters: [
      { name: "name", type: "string", required: true, description: "Agent name" },
      { name: "type", type: "string", required: true, description: "Agent type" },
      { name: "description", type: "string", required: false, description: "Agent description" },
      { name: "personality", type: "string", required: false, description: "Personality traits" },
      { name: "domain", type: "string", required: false, description: "Domain expertise" },
    ],
    channel: "agent-builder:generate-system-prompt",
  },
  {
    id: "agent_builder.execute",
    category: "agent_builder",
    name: "Execute Agent",
    description: "Run an agent with given input and optional session context",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
      { name: "input", type: "string", required: true, description: "Input text for the agent" },
      { name: "sessionId", type: "string", required: false, description: "Session ID for conversation continuity" },
    ],
    channel: "agent-builder:execute-agent",
  },
  {
    id: "agent_builder.list_executions",
    category: "agent_builder",
    name: "List Agent Executions",
    description: "List execution history for agents",
    parameters: [
      { name: "agentId", type: "string", required: false, description: "Filter by agent ID" },
      { name: "limit", type: "number", required: false, description: "Max results" },
    ],
    channel: "agent-builder:list-executions",
  },
  {
    id: "agent_builder.list_templates",
    category: "agent_builder",
    name: "List Agent Templates",
    description: "List available agent templates",
    parameters: [],
    channel: "agent-builder:list-templates",
  },
  {
    id: "agent_builder.list_builtin_tools",
    category: "agent_builder",
    name: "List Built-in Tools",
    description: "List all available built-in tools that can be added to agents",
    parameters: [],
    channel: "agent-builder:list-builtin-tools",
  },
  {
    id: "agent_builder.get_stats",
    category: "agent_builder",
    name: "Get Agent Stats",
    description: "Get usage and performance statistics for an agent",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
    ],
    channel: "agent-builder:get-agent-stats",
    positional: true,
  },

  // ── Agent Factory ──
  {
    id: "agent_factory.create",
    category: "agent_factory",
    name: "Create Custom Agent",
    description: "Create a custom AI agent with specific model, personality, and training",
    parameters: [
      { name: "name", type: "string", required: true, description: "Agent name" },
      { name: "displayName", type: "string", required: true, description: "Display name" },
      { name: "description", type: "string", required: true, description: "Agent description" },
      { name: "type", type: "string", required: true, description: "Agent type" },
      { name: "baseModelProvider", type: "string", required: true, description: "Provider: ollama, lmstudio, transformers, custom" },
      { name: "baseModelId", type: "string", required: true, description: "Base model ID" },
      { name: "systemPrompt", type: "string", required: true, description: "System prompt" },
    ],
    channel: "agent-factory:create",
  },
  {
    id: "agent_factory.list",
    category: "agent_factory",
    name: "List Custom Agents",
    description: "List all custom agents from the factory",
    parameters: [],
    channel: "agent-factory:list",
  },
  {
    id: "agent_factory.get",
    category: "agent_factory",
    name: "Get Custom Agent",
    description: "Get details of a custom agent by ID",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
    ],
    channel: "agent-factory:get",
    positional: true,
  },
  {
    id: "agent_factory.delete",
    category: "agent_factory",
    name: "Delete Custom Agent",
    description: "Delete a custom agent",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
    ],
    channel: "agent-factory:delete",
    positional: true,
  },
  {
    id: "agent_factory.duplicate",
    category: "agent_factory",
    name: "Duplicate Custom Agent",
    description: "Create a copy of an existing custom agent",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID to duplicate" },
    ],
    channel: "agent-factory:duplicate",
    positional: true,
  },
  {
    id: "agent_factory.train",
    category: "agent_factory",
    name: "Train Custom Agent",
    description: "Start fine-tuning/training a custom agent on a dataset",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
      { name: "datasetPath", type: "string", required: true, description: "Path to training dataset" },
      { name: "datasetFormat", type: "string", required: true, description: "Dataset format" },
      { name: "method", type: "string", required: true, description: "Training method: lora, qlora, dora" },
    ],
    channel: "agent-factory:start-training",
  },
  {
    id: "agent_factory.training_status",
    category: "agent_factory",
    name: "Agent Training Status",
    description: "Check the training status of a custom agent",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
    ],
    channel: "agent-factory:training-status",
    positional: true,
  },
  {
    id: "agent_factory.test",
    category: "agent_factory",
    name: "Test Custom Agent",
    description: "Run a test interaction with a custom agent",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
      { name: "input", type: "string", required: true, description: "Test input" },
    ],
    channel: "agent-factory:test",
  },
  {
    id: "agent_factory.list_templates",
    category: "agent_factory",
    name: "List Factory Templates",
    description: "List available agent factory templates",
    parameters: [],
    channel: "agent-factory:list-templates",
  },
  {
    id: "agent_factory.export",
    category: "agent_factory",
    name: "Export Custom Agent",
    description: "Export a custom agent to a portable file",
    parameters: [
      { name: "agentId", type: "string", required: true, description: "The agent ID" },
    ],
    channel: "agent-factory:export",
    positional: true,
  },

  // ── Agent Workspace ──
  {
    id: "agent_workspace.create_task",
    category: "agent_workspace",
    name: "Create Agent Task",
    description: "Create a task for an agent to execute",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
      { name: "name", type: "string", required: true, description: "Task name" },
      { name: "description", type: "string", required: true, description: "Task description" },
      { name: "type", type: "string", required: true, description: "Task type" },
    ],
    channel: "agent:workspace:task:create",
  },
  {
    id: "agent_workspace.list_tasks",
    category: "agent_workspace",
    name: "List Agent Tasks",
    description: "List tasks assigned to agents",
    parameters: [
      { name: "agentId", type: "number", required: false, description: "Filter by agent ID" },
    ],
    channel: "agent:workspace:task:list",
  },
  {
    id: "agent_workspace.execute_task",
    category: "agent_workspace",
    name: "Execute Agent Task",
    description: "Execute a specific agent task",
    parameters: [
      { name: "taskId", type: "string", required: true, description: "The task ID" },
    ],
    channel: "agent:workspace:task:execute",
  },
  {
    id: "agent_workspace.add_knowledge",
    category: "agent_workspace",
    name: "Add Knowledge Source",
    description: "Add a knowledge source (RAG) to an agent workspace",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
      { name: "name", type: "string", required: true, description: "Knowledge source name" },
      { name: "type", type: "string", required: true, description: "Source type: file, url, api, database" },
    ],
    channel: "agent:workspace:knowledge:add",
  },
  {
    id: "agent_workspace.list_knowledge",
    category: "agent_workspace",
    name: "List Knowledge Sources",
    description: "List all knowledge sources for an agent",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:workspace:knowledge:list",
    positional: true,
  },
  {
    id: "agent_workspace.query_knowledge",
    category: "agent_workspace",
    name: "Query Knowledge Base",
    description: "Search an agent's knowledge base with a natural language query",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
      { name: "query", type: "string", required: true, description: "Search query" },
      { name: "maxResults", type: "number", required: false, description: "Max results (default 10)" },
    ],
    channel: "agent:workspace:knowledge:query",
  },
  {
    id: "agent_workspace.get",
    category: "agent_workspace",
    name: "Get Agent Workspace",
    description: "Get the full workspace overview for an agent",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:workspace:get",
    positional: true,
  },

  // ── Agent Export ──
  {
    id: "agent_export.json",
    category: "agent_export",
    name: "Export Agent as JSON",
    description: "Export an agent configuration as a portable JSON file",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:export:json",
    positional: true,
  },
  {
    id: "agent_export.docker",
    category: "agent_export",
    name: "Export Agent as Docker",
    description: "Export an agent as a Docker container configuration",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:export:docker",
    positional: true,
  },
  {
    id: "agent_export.standalone",
    category: "agent_export",
    name: "Export Agent as Standalone",
    description: "Export an agent as a standalone executable",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:export:standalone",
    positional: true,
  },
  {
    id: "agent_export.web_chat",
    category: "agent_export",
    name: "Export Agent Web Chat",
    description: "Export an agent as an embeddable web chat widget",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:export:web-chat",
    positional: true,
  },
  {
    id: "agent_export.embed_snippet",
    category: "agent_export",
    name: "Get Agent Embed Snippet",
    description: "Get HTML/JS embed snippet for an agent chat widget",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:export:embed-snippet",
    positional: true,
  },

  // ── Agent Sharing ──
  {
    id: "agent_sharing.create",
    category: "agent_sharing",
    name: "Create Agent Share Config",
    description: "Create a sharing configuration to share an agent with others",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
      { name: "title", type: "string", required: false, description: "Share title" },
    ],
    channel: "agent:share:create",
  },
  {
    id: "agent_sharing.get",
    category: "agent_sharing",
    name: "Get Agent Share Config",
    description: "Get the sharing configuration for an agent",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:share:get",
    positional: true,
  },
  {
    id: "agent_sharing.generate_codes",
    category: "agent_sharing",
    name: "Generate Agent Share Codes",
    description: "Generate access codes for sharing an agent",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:share:generate-codes",
    positional: true,
  },

  // ── Orchestrator ──
  {
    id: "orchestrator.submit_task",
    category: "orchestrator",
    name: "Submit Orchestrator Task",
    description: "Submit a complex task to the multi-agent orchestrator",
    parameters: [
      { name: "input", type: "object", required: true, description: "Task input configuration" },
    ],
    channel: "orchestrator:submit-task",
  },
  {
    id: "orchestrator.list",
    category: "orchestrator",
    name: "List Orchestrations",
    description: "List all orchestration tasks and their status",
    parameters: [
      { name: "status", type: "string", required: false, description: "Filter by status" },
      { name: "limit", type: "number", required: false, description: "Max results" },
    ],
    channel: "orchestrator:list",
  },
  {
    id: "orchestrator.get",
    category: "orchestrator",
    name: "Get Orchestration",
    description: "Get details of a specific orchestration task",
    parameters: [
      { name: "id", type: "string", required: true, description: "Orchestration ID" },
    ],
    channel: "orchestrator:get",
    positional: true,
  },
  {
    id: "orchestrator.cancel",
    category: "orchestrator",
    name: "Cancel Orchestration",
    description: "Cancel a running orchestration task",
    parameters: [
      { name: "id", type: "string", required: true, description: "Orchestration ID" },
    ],
    channel: "orchestrator:cancel",
    positional: true,
  },
  {
    id: "orchestrator.status",
    category: "orchestrator",
    name: "Orchestrator Status",
    description: "Get the overall status of the orchestrator system",
    parameters: [],
    channel: "orchestrator:status",
  },
  {
    id: "orchestrator.dashboard",
    category: "orchestrator",
    name: "Orchestrator Dashboard",
    description: "Get the orchestrator dashboard with all active tasks and metrics",
    parameters: [],
    channel: "orchestrator:dashboard",
  },
  {
    id: "orchestrator.templates",
    category: "orchestrator",
    name: "List Orchestrator Templates",
    description: "List available orchestration task templates",
    parameters: [],
    channel: "orchestrator:templates",
  },

  // ── Agent Swarm ──
  {
    id: "swarm.create",
    category: "swarm",
    name: "Create Agent Swarm",
    description: "Create a new multi-agent swarm for collaborative tasks",
    parameters: [
      { name: "name", type: "string", required: true, description: "Swarm name" },
      { name: "description", type: "string", required: false, description: "Swarm description" },
    ],
    channel: "agent-swarm:create-swarm",
  },
  {
    id: "swarm.list",
    category: "swarm",
    name: "List Swarms",
    description: "List all agent swarms",
    parameters: [],
    channel: "agent-swarm:list-swarms",
  },
  {
    id: "swarm.get",
    category: "swarm",
    name: "Get Swarm",
    description: "Get details of a specific swarm",
    parameters: [
      { name: "swarmId", type: "string", required: true, description: "The swarm ID" },
    ],
    channel: "agent-swarm:get-swarm",
    positional: true,
  },
  {
    id: "swarm.start",
    category: "swarm",
    name: "Start Swarm",
    description: "Start a swarm so its agents begin processing tasks",
    parameters: [
      { name: "swarmId", type: "string", required: true, description: "The swarm ID" },
    ],
    channel: "agent-swarm:start-swarm",
    positional: true,
  },
  {
    id: "swarm.list_agents",
    category: "swarm",
    name: "List Swarm Agents",
    description: "List all agents in a swarm",
    parameters: [
      { name: "swarmId", type: "string", required: true, description: "The swarm ID" },
    ],
    channel: "agent-swarm:list-agents",
    positional: true,
  },

  // ── Agent Triggers & Stack ──
  {
    id: "agent_trigger.create",
    category: "agent_trigger",
    name: "Create Agent Trigger",
    description: "Create an event trigger that auto-activates an agent",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
      { name: "type", type: "string", required: true, description: "Trigger type: schedule, webhook, event, file" },
      { name: "name", type: "string", required: true, description: "Trigger name" },
    ],
    channel: "agent:trigger:create",
  },
  {
    id: "agent_trigger.list",
    category: "agent_trigger",
    name: "List Agent Triggers",
    description: "List all triggers for agents",
    parameters: [],
    channel: "agent:trigger:list",
  },
  {
    id: "agent_trigger.activate",
    category: "agent_trigger",
    name: "Activate Agent Trigger",
    description: "Activate a paused trigger",
    parameters: [
      { name: "triggerId", type: "string", required: true, description: "The trigger ID" },
    ],
    channel: "agent:trigger:activate",
    positional: true,
  },
  {
    id: "agent_tool_catalog.list",
    category: "agent_trigger",
    name: "List Tool Catalog",
    description: "List all available tools in the agent tool catalog",
    parameters: [],
    channel: "agent:tool-catalog:list",
  },
  {
    id: "agent_tool_catalog.search",
    category: "agent_trigger",
    name: "Search Tool Catalog",
    description: "Search for tools by name or description",
    parameters: [
      { name: "query", type: "string", required: true, description: "Search query" },
    ],
    channel: "agent:tool-catalog:search",
    positional: true,
  },
  {
    id: "agent_stack.build",
    category: "agent_trigger",
    name: "Build Agent Stack",
    description: "Build a complete agent stack with tools, triggers, and workflows",
    parameters: [
      { name: "agentId", type: "number", required: true, description: "The agent ID" },
    ],
    channel: "agent:stack:build",
  },

  // ── Model Management ──
  {
    id: "model.detect_hardware",
    category: "model",
    name: "Detect Hardware",
    description: "Detect GPU/CPU capabilities for AI model selection",
    parameters: [],
    channel: "model-manager:detect-hardware",
  },
  {
    id: "model.get_catalog",
    category: "model",
    name: "Get Model Catalog",
    description: "Get the full catalog of available AI models to download",
    parameters: [],
    channel: "model-manager:get-catalog",
  },
  {
    id: "model.download",
    category: "model",
    name: "Download Model",
    description: "Download and install an AI model from the catalog",
    parameters: [
      { name: "modelId", type: "string", required: true, description: "Model ID to download" },
    ],
    channel: "model-manager:pull-model",
    positional: true,
  },
  {
    id: "model.list_installed",
    category: "model",
    name: "List Installed Models",
    description: "List all locally installed AI models",
    parameters: [],
    channel: "model-manager:list-installed",
  },
  {
    id: "model.get_pull_status",
    category: "model",
    name: "Get Download Status",
    description: "Check the status of pending model downloads",
    parameters: [],
    channel: "model-manager:get-pull-status",
  },

  // ── Document Generation (LibreOffice) ──
  {
    id: "document.create",
    category: "document",
    name: "Create Document",
    description: "Create a new document (Word, PDF, presentation) using AI",
    parameters: [
      { name: "type", type: "string", required: true, description: "Document type: document, spreadsheet, presentation, pdf" },
      { name: "name", type: "string", required: true, description: "Document name" },
      { name: "prompt", type: "string", required: false, description: "AI prompt describing the document content to generate" },
      { name: "tone", type: "string", required: false, description: "Writing tone: professional, casual, academic, creative, technical" },
      { name: "length", type: "string", required: false, description: "Document length: short, medium, long, detailed" },
    ],
    channel: "libreoffice:create",
  },
  {
    id: "document.list",
    category: "document",
    name: "List Documents",
    description: "List all generated documents",
    parameters: [],
    channel: "libreoffice:list",
  },
  {
    id: "document.get",
    category: "document",
    name: "Get Document",
    description: "Get details of a specific document",
    parameters: [
      { name: "id", type: "number", required: true, description: "Document ID" },
    ],
    channel: "libreoffice:get",
    positional: true,
  },
  {
    id: "document.export",
    category: "document",
    name: "Export Document",
    description: "Export a document to a specific format (PDF, DOCX, etc.)",
    parameters: [
      { name: "id", type: "number", required: true, description: "Document ID" },
      { name: "format", type: "string", required: true, description: "Export format: pdf, docx, xlsx, pptx, html" },
    ],
    channel: "libreoffice:export",
  },
  {
    id: "document.delete",
    category: "document",
    name: "Delete Document",
    description: "Delete a document",
    parameters: [
      { name: "id", type: "number", required: true, description: "Document ID" },
    ],
    channel: "libreoffice:delete",
    positional: true,
  },
  {
    id: "document.read_content",
    category: "document",
    name: "Read Document Content",
    description: "Read the text content of a document",
    parameters: [
      { name: "id", type: "number", required: true, description: "Document ID" },
    ],
    channel: "libreoffice:read-content",
    positional: true,
  },
  {
    id: "document.status",
    category: "document",
    name: "Document Engine Status",
    description: "Check if the document generation engine is ready",
    parameters: [],
    channel: "libreoffice:status",
  },

  // ── Media Pipeline ──
  {
    id: "media.process_image",
    category: "media",
    name: "Process Image",
    description: "Process an image (resize, convert, filter, watermark)",
    parameters: [
      { name: "inputPath", type: "string", required: true, description: "Path to input image" },
      { name: "outputPath", type: "string", required: false, description: "Path for output image" },
    ],
    channel: "media-pipeline:process-image",
  },
  {
    id: "media.process_video",
    category: "media",
    name: "Process Video",
    description: "Process a video (transcode, trim, resize, extract audio)",
    parameters: [
      { name: "inputPath", type: "string", required: true, description: "Path to input video" },
      { name: "outputPath", type: "string", required: false, description: "Path for output video" },
    ],
    channel: "media-pipeline:process-video",
  },
  {
    id: "media.process_audio",
    category: "media",
    name: "Process Audio",
    description: "Process an audio file (convert, normalize, trim)",
    parameters: [
      { name: "inputPath", type: "string", required: true, description: "Path to input audio" },
      { name: "outputPath", type: "string", required: false, description: "Path for output audio" },
    ],
    channel: "media-pipeline:process-audio",
  },
  {
    id: "media.generate_thumbnail",
    category: "media",
    name: "Generate Thumbnail",
    description: "Generate a thumbnail from an image or video",
    parameters: [
      { name: "inputPath", type: "string", required: true, description: "Path to input file" },
    ],
    channel: "media-pipeline:generate-thumbnail",
  },
  {
    id: "media.extract_metadata",
    category: "media",
    name: "Extract Image Metadata",
    description: "Extract EXIF/metadata from an image file",
    parameters: [
      { name: "filePath", type: "string", required: true, description: "Path to image file" },
    ],
    channel: "media-pipeline:extract-image-metadata",
    positional: true,
  },
  {
    id: "media.detect_scenes",
    category: "media",
    name: "Detect Video Scenes",
    description: "Detect scene changes in a video",
    parameters: [
      { name: "inputPath", type: "string", required: true, description: "Path to input video" },
    ],
    channel: "media-pipeline:detect-scenes",
  },
  {
    id: "media.check_tools",
    category: "media",
    name: "Check Media Tools",
    description: "Check if FFmpeg and other media tools are available",
    parameters: [],
    channel: "media-pipeline:check-tools",
  },

  // ── Neural Network Builder ──
  {
    id: "neural.create",
    category: "neural",
    name: "Create Neural Network",
    description: "Create a new neural network architecture",
    parameters: [
      { name: "name", type: "string", required: true, description: "Network name" },
    ],
    channel: "neural:create-network",
  },
  {
    id: "neural.list",
    category: "neural",
    name: "List Neural Networks",
    description: "List all created neural networks",
    parameters: [],
    channel: "neural:list-networks",
  },
  {
    id: "neural.get",
    category: "neural",
    name: "Get Neural Network",
    description: "Get details of a neural network",
    parameters: [
      { name: "id", type: "string", required: true, description: "Network ID" },
    ],
    channel: "neural:get-network",
    positional: true,
  },
  {
    id: "neural.train",
    category: "neural",
    name: "Train Neural Network",
    description: "Start training a neural network",
    parameters: [
      { name: "id", type: "string", required: true, description: "Network ID" },
    ],
    channel: "neural:start-training",
    positional: true,
  },
  {
    id: "neural.validate",
    category: "neural",
    name: "Validate Neural Network",
    description: "Validate a neural network architecture for errors",
    parameters: [
      { name: "networkId", type: "string", required: true, description: "Network ID" },
      { name: "layerId", type: "string", required: false, description: "Specific layer ID to validate" },
    ],
    channel: "neural:update-network",
  },
  {
    id: "neural.export",
    category: "neural",
    name: "Export Neural Network",
    description: "Export a trained neural network model",
    parameters: [
      { name: "networkId", type: "string", required: true, description: "Network ID" },
      { name: "notes", type: "string", required: true, description: "Version notes" },
    ],
    channel: "neural:create-version",
  },
  {
    id: "neural.list_ab_tests",
    category: "neural",
    name: "List A/B Tests",
    description: "List all neural network A/B tests",
    parameters: [],
    channel: "neural:list-ab-tests",
  },

  // ── CI/CD Pipeline Builder ──
  {
    id: "cicd.create_pipeline",
    category: "cicd",
    name: "Create CI/CD Pipeline",
    description: "Create a new CI/CD pipeline for automated builds and deployments",
    parameters: [
      { name: "name", type: "string", required: true, description: "Pipeline name" },
      { name: "workingDirectory", type: "string", required: true, description: "Working directory path" },
      { name: "description", type: "string", required: false, description: "Pipeline description" },
      { name: "templateId", type: "string", required: false, description: "Template to base pipeline on" },
    ],
    channel: "cicd:create-pipeline",
  },
  {
    id: "cicd.list_pipelines",
    category: "cicd",
    name: "List CI/CD Pipelines",
    description: "List all CI/CD pipelines",
    parameters: [],
    channel: "cicd:list-pipelines",
  },
  {
    id: "cicd.get_pipeline",
    category: "cicd",
    name: "Get CI/CD Pipeline",
    description: "Get details of a specific pipeline",
    parameters: [
      { name: "id", type: "string", required: true, description: "Pipeline ID" },
    ],
    channel: "cicd:get-pipeline",
    positional: true,
  },
  {
    id: "cicd.run_pipeline",
    category: "cicd",
    name: "Run CI/CD Pipeline",
    description: "Execute a CI/CD pipeline and start a new run",
    parameters: [
      { name: "pipelineId", type: "string", required: true, description: "Pipeline ID" },
      { name: "branch", type: "string", required: false, description: "Git branch to build" },
    ],
    channel: "cicd:run-pipeline",
  },
  {
    id: "cicd.list_runs",
    category: "cicd",
    name: "List Pipeline Runs",
    description: "List all runs for a CI/CD pipeline",
    parameters: [
      { name: "pipelineId", type: "string", required: false, description: "Filter by pipeline ID" },
    ],
    channel: "cicd:list-runs",
    positional: true,
  },
  {
    id: "cicd.get_templates",
    category: "cicd",
    name: "List CI/CD Templates",
    description: "List available CI/CD pipeline templates",
    parameters: [],
    channel: "cicd:get-templates",
  },

  // ── Calendar ──
  {
    id: "calendar.list_sources",
    category: "calendar",
    name: "List Calendar Sources",
    description: "List all connected calendar sources (Google, Outlook, iCal)",
    parameters: [],
    channel: "calendar:list-sources",
  },
  {
    id: "calendar.add_source",
    category: "calendar",
    name: "Add Calendar Source",
    description: "Add a new calendar source to sync events from",
    parameters: [
      { name: "name", type: "string", required: true, description: "Calendar name" },
      { name: "type", type: "string", required: true, description: "Source type: google, outlook, ical, caldav" },
      { name: "color", type: "string", required: false, description: "Calendar color" },
    ],
    channel: "calendar:add-source",
  },
  {
    id: "calendar.list_events",
    category: "calendar",
    name: "List Calendar Events",
    description: "List calendar events within a date range",
    parameters: [
      { name: "startAt", type: "number", required: true, description: "Start timestamp (ms)" },
      { name: "endAt", type: "number", required: true, description: "End timestamp (ms)" },
    ],
    channel: "calendar:list-events",
  },
  {
    id: "calendar.create_event",
    category: "calendar",
    name: "Create Calendar Event",
    description: "Create a new calendar event",
    parameters: [
      { name: "title", type: "string", required: true, description: "Event title" },
      { name: "startAt", type: "number", required: true, description: "Start timestamp (ms)" },
      { name: "endAt", type: "number", required: true, description: "End timestamp (ms)" },
      { name: "description", type: "string", required: false, description: "Event description" },
    ],
    channel: "calendar:create-event",
  },
  {
    id: "calendar.sync_all",
    category: "calendar",
    name: "Sync All Calendars",
    description: "Sync all connected calendar sources",
    parameters: [],
    channel: "calendar:sync-all",
  },
  {
    id: "calendar.export_ics",
    category: "calendar",
    name: "Export Event as ICS",
    description: "Export a calendar event as an ICS file",
    parameters: [
      { name: "eventId", type: "string", required: true, description: "Event ID" },
    ],
    channel: "calendar:export-ics",
  },

  // ── Services Management ──
  {
    id: "services.list",
    category: "services",
    name: "List Services",
    description: "List all managed services (Ollama, n8n, PostgreSQL, etc.)",
    parameters: [],
    channel: "services:list",
  },
  {
    id: "services.status_all",
    category: "services",
    name: "All Services Status",
    description: "Get the status of all managed services",
    parameters: [],
    channel: "services:status:all",
  },
  {
    id: "services.start_all",
    category: "services",
    name: "Start All Services",
    description: "Start all managed services",
    parameters: [],
    channel: "services:start:all",
  },
  {
    id: "services.stop_all",
    category: "services",
    name: "Stop All Services",
    description: "Stop all managed services",
    parameters: [],
    channel: "services:stop:all",
  },

  // ── Secrets Vault ──
  {
    id: "secrets.get_status",
    category: "secrets",
    name: "Vault Status",
    description: "Check if the secrets vault exists and its lock status",
    parameters: [],
    channel: "secrets-vault:get-status",
  },
  {
    id: "secrets.list",
    category: "secrets",
    name: "List Secrets",
    description: "List all stored secrets (names only, not values)",
    parameters: [
      { name: "type", type: "string", required: false, description: "Filter by type: api_key, password, token, certificate" },
      { name: "category", type: "string", required: false, description: "Filter by category" },
      { name: "search", type: "string", required: false, description: "Search query" },
    ],
    channel: "secrets-vault:list-secrets",
  },
  {
    id: "secrets.create",
    category: "secrets",
    name: "Create Secret",
    description: "Store a new secret in the encrypted vault",
    parameters: [
      { name: "name", type: "string", required: true, description: "Secret name" },
      { name: "type", type: "string", required: true, description: "Secret type: api_key, password, token, certificate, ssh_key, other" },
      { name: "category", type: "string", required: true, description: "Category: ai, cloud, database, messaging, payment, social, devops, other" },
      { name: "value", type: "string", required: true, description: "Secret value" },
      { name: "description", type: "string", required: false, description: "Description" },
    ],
    channel: "secrets-vault:create-secret",
  },
  {
    id: "secrets.get",
    category: "secrets",
    name: "Get Secret",
    description: "Retrieve a secret value from the vault (vault must be unlocked)",
    parameters: [
      { name: "secretId", type: "string", required: true, description: "Secret ID" },
    ],
    channel: "secrets-vault:get-secret",
  },
  {
    id: "secrets.delete",
    category: "secrets",
    name: "Delete Secret",
    description: "Delete a secret from the vault",
    parameters: [
      { name: "secretId", type: "string", required: true, description: "Secret ID" },
    ],
    channel: "secrets-vault:delete-secret",
  },
  {
    id: "secrets.get_stats",
    category: "secrets",
    name: "Vault Stats",
    description: "Get statistics about stored secrets",
    parameters: [],
    channel: "secrets-vault:get-stats",
  },

  // ── Analytics & Reporting ──
  {
    id: "analytics.dataset",
    category: "analytics",
    name: "Dataset Analytics",
    description: "Get analytics for a specific dataset",
    parameters: [
      { name: "datasetId", type: "string", required: true, description: "Dataset ID" },
    ],
    channel: "analytics:dataset",
    positional: true,
  },
  {
    id: "analytics.global",
    category: "analytics",
    name: "Global Analytics",
    description: "Get global analytics across all datasets and activities",
    parameters: [],
    channel: "analytics:global",
  },
  {
    id: "analytics.generate_report",
    category: "analytics",
    name: "Generate Report",
    description: "Generate an analytics report",
    parameters: [
      { name: "name", type: "string", required: true, description: "Report name" },
      { name: "type", type: "string", required: true, description: "Report type: dataset, global, quality, custom" },
    ],
    channel: "analytics:generate-report",
  },
  {
    id: "analytics.list_reports",
    category: "analytics",
    name: "List Reports",
    description: "List all generated analytics reports",
    parameters: [
      { name: "type", type: "string", required: false, description: "Filter by type" },
    ],
    channel: "analytics:list-reports",
  },
  {
    id: "analytics.get_dashboard",
    category: "analytics",
    name: "Get Dashboard",
    description: "Get an analytics dashboard with widgets and metrics",
    parameters: [
      { name: "dashboardId", type: "string", required: false, description: "Dashboard ID (default: main)" },
    ],
    channel: "analytics:get-dashboard",
    positional: true,
  },

  // ── Model Training ──
  {
    id: "training.train",
    category: "training",
    name: "Train on Dataset",
    description: "Start training/fine-tuning an AI model on a custom dataset",
    parameters: [
      { name: "datasetId", type: "string", required: true, description: "Dataset ID" },
      { name: "baseModelId", type: "string", required: true, description: "Base model to fine-tune" },
      { name: "method", type: "string", required: false, description: "Training method" },
    ],
    channel: "training:train-on-dataset",
  },
  {
    id: "training.get_status",
    category: "training",
    name: "Training Status",
    description: "Get the status of a training job",
    parameters: [
      { name: "jobId", type: "string", required: true, description: "Training job ID" },
    ],
    channel: "training:get-status",
    positional: true,
  },
  {
    id: "training.list_jobs",
    category: "training",
    name: "List Training Jobs",
    description: "List all training jobs and their status",
    parameters: [],
    channel: "training:list-jobs",
  },
  {
    id: "training.list_models",
    category: "training",
    name: "List Trained Models",
    description: "List all models that have been fine-tuned",
    parameters: [],
    channel: "training:list-trained-models",
  },
  {
    id: "training.list_base_models",
    category: "training",
    name: "List Base Models",
    description: "List available base models for fine-tuning",
    parameters: [],
    channel: "training:list-base-models",
  },
  {
    id: "training.get_system_info",
    category: "training",
    name: "Training System Info",
    description: "Get system info for training (GPU, memory, capabilities)",
    parameters: [],
    channel: "training:get-system-info",
  },

  // ── Data Annotation ──
  {
    id: "annotation.create_taxonomy",
    category: "annotation",
    name: "Create Label Taxonomy",
    description: "Create a label taxonomy for data annotation tasks",
    parameters: [
      { name: "name", type: "string", required: true, description: "Taxonomy name" },
      { name: "type", type: "string", required: true, description: "Type: classification, detection, segmentation, ner, qa, custom" },
    ],
    channel: "annotation:create-taxonomy",
  },
  {
    id: "annotation.list_taxonomies",
    category: "annotation",
    name: "List Taxonomies",
    description: "List all label taxonomies",
    parameters: [],
    channel: "annotation:list-taxonomies",
  },
  {
    id: "annotation.create_task",
    category: "annotation",
    name: "Create Annotation Task",
    description: "Create a new data annotation task",
    parameters: [
      { name: "datasetId", type: "string", required: true, description: "Dataset ID to annotate" },
      { name: "taxonomyId", type: "string", required: true, description: "Label taxonomy to use" },
      { name: "name", type: "string", required: true, description: "Task name" },
      { name: "description", type: "string", required: false, description: "Task description" },
    ],
    channel: "annotation:create-task",
  },
  {
    id: "annotation.list_tasks",
    category: "annotation",
    name: "List Annotation Tasks",
    description: "List all annotation tasks",
    parameters: [
      { name: "datasetId", type: "string", required: false, description: "Filter by dataset" },
      { name: "status", type: "string", required: false, description: "Filter by status" },
    ],
    channel: "annotation:list-tasks",
  },
  {
    id: "annotation.export",
    category: "annotation",
    name: "Export Annotations",
    description: "Export annotated data in a specific format (JSON, CSV, COCO, Pascal VOC)",
    parameters: [
      { name: "taskId", type: "string", required: true, description: "Task ID" },
      { name: "format", type: "string", required: true, description: "Export format: json, csv, coco, pascal-voc" },
      { name: "outputPath", type: "string", required: true, description: "Output file path" },
    ],
    channel: "annotation:export",
  },
  {
    id: "annotation.calculate_agreement",
    category: "annotation",
    name: "Calculate Agreement",
    description: "Calculate inter-annotator agreement for a task",
    parameters: [
      { name: "taskId", type: "string", required: true, description: "Task ID" },
    ],
    channel: "annotation:calculate-agreement",
    positional: true,
  },

  // ── AI Learning Profiles ──
  {
    id: "learning.create_profile",
    category: "learning",
    name: "Create Learning Profile",
    description: "Create an AI learning profile that adapts to your style",
    parameters: [
      { name: "name", type: "string", required: true, description: "Profile name" },
      { name: "description", type: "string", required: false, description: "Profile description" },
    ],
    channel: "ai-learning:create-profile",
  },
  {
    id: "learning.list_profiles",
    category: "learning",
    name: "List Learning Profiles",
    description: "List all AI learning profiles",
    parameters: [],
    channel: "ai-learning:list-profiles",
  },
  {
    id: "learning.get_style_guide",
    category: "learning",
    name: "Get Style Guide",
    description: "Get the learned communication style guide",
    parameters: [],
    channel: "ai-learning:get-style-guide",
  },
  {
    id: "learning.get_stats",
    category: "learning",
    name: "Learning Stats",
    description: "Get statistics about AI learning and adaptation",
    parameters: [],
    channel: "ai-learning:get-stats",
  },
  {
    id: "learning.search_patterns",
    category: "learning",
    name: "Search Learned Patterns",
    description: "Search through learned patterns by query",
    parameters: [
      { name: "query", type: "string", required: true, description: "Search query" },
    ],
    channel: "ai-learning:search-patterns",
  },

  // ── Asset Studio ──
  {
    id: "asset.list",
    category: "asset",
    name: "List Assets",
    description: "List all assets by type (algorithms, schemas, prompts, APIs, etc.)",
    parameters: [
      { name: "assetType", type: "string", required: true, description: "Type: algorithm, schema, prompt, ui-component, api, training-data" },
    ],
    channel: "assets:list",
    positional: true,
  },
  {
    id: "asset.list_all",
    category: "asset",
    name: "List All Assets",
    description: "List all assets across all types",
    parameters: [],
    channel: "assets:list-all",
  },
  {
    id: "asset.get",
    category: "asset",
    name: "Get Asset",
    description: "Get details of a specific asset",
    parameters: [
      { name: "assetType", type: "string", required: true, description: "Asset type" },
      { name: "assetId", type: "string", required: true, description: "Asset ID" },
    ],
    channel: "assets:get",
  },
  {
    id: "asset.stats",
    category: "asset",
    name: "Asset Stats",
    description: "Get statistics about all assets",
    parameters: [],
    channel: "assets:stats",
  },
  {
    id: "asset.create_algorithm",
    category: "asset",
    name: "Create Algorithm Asset",
    description: "Create a reusable algorithm asset",
    parameters: [
      { name: "name", type: "string", required: true, description: "Algorithm name" },
      { name: "language", type: "string", required: true, description: "Programming language" },
      { name: "algorithmType", type: "string", required: true, description: "Algorithm type" },
      { name: "code", type: "string", required: true, description: "Algorithm source code" },
    ],
    channel: "assets:create:algorithm",
  },
  {
    id: "asset.create_prompt",
    category: "asset",
    name: "Create Prompt Asset",
    description: "Create a reusable prompt template asset",
    parameters: [
      { name: "name", type: "string", required: true, description: "Prompt name" },
      { name: "prompt", type: "string", required: true, description: "Prompt template text" },
      { name: "description", type: "string", required: false, description: "Description" },
    ],
    channel: "assets:create:prompt",
  },
  {
    id: "asset.create_api",
    category: "asset",
    name: "Create API Asset",
    description: "Create an API integration asset with OpenAPI spec",
    parameters: [
      { name: "name", type: "string", required: true, description: "API name" },
      { name: "openApiSpec", type: "string", required: true, description: "OpenAPI spec (JSON or YAML)" },
      { name: "description", type: "string", required: false, description: "Description" },
    ],
    channel: "assets:create:api",
  },
  {
    id: "asset.delete",
    category: "asset",
    name: "Delete Asset",
    description: "Delete an asset",
    parameters: [
      { name: "assetType", type: "string", required: true, description: "Asset type" },
      { name: "assetId", type: "string", required: true, description: "Asset ID" },
    ],
    channel: "assets:delete",
  },

  // ── Compute Network ──
  {
    id: "compute.get_status",
    category: "compute",
    name: "Compute Network Status",
    description: "Get the status of the distributed compute network",
    parameters: [],
    channel: "compute-network:get-status",
  },
  {
    id: "compute.get_peers",
    category: "compute",
    name: "List Compute Peers",
    description: "List all connected peers in the compute network",
    parameters: [],
    channel: "compute-network:get-peers",
  },
  {
    id: "compute.list_jobs",
    category: "compute",
    name: "List Compute Jobs",
    description: "List all compute jobs (active, pending, completed)",
    parameters: [],
    channel: "compute-network:get-jobs",
  },
  {
    id: "compute.get_job_stats",
    category: "compute",
    name: "Compute Job Stats",
    description: "Get aggregated statistics for compute jobs",
    parameters: [],
    channel: "compute-network:get-job-stats",
  },
  {
    id: "compute.get_system_metrics",
    category: "compute",
    name: "System Metrics",
    description: "Get system resource metrics (CPU, memory, GPU)",
    parameters: [],
    channel: "compute-network:get-system-metrics",
  },

  // ── Voice Assistant ──
  {
    id: "voice.transcribe",
    category: "voice",
    name: "Transcribe Audio",
    description: "Transcribe an audio file to text using Whisper",
    parameters: [
      { name: "audioPath", type: "string", required: true, description: "Path to audio file" },
    ],
    channel: "voice:transcribe-file",
    positional: true,
  },
  {
    id: "voice.speak",
    category: "voice",
    name: "Text to Speech",
    description: "Convert text to speech audio",
    parameters: [
      { name: "text", type: "string", required: true, description: "Text to speak" },
    ],
    channel: "voice:speak",
  },
  {
    id: "voice.get_capabilities",
    category: "voice",
    name: "Voice Capabilities",
    description: "Get available voice/TTS capabilities and installed models",
    parameters: [],
    channel: "voice:get-capabilities",
  },
  {
    id: "voice.get_config",
    category: "voice",
    name: "Voice Config",
    description: "Get current voice assistant configuration",
    parameters: [],
    channel: "voice:get-config",
  },

  // ── Blockchain / Subgraph ──
  {
    id: "blockchain.my_assets",
    category: "blockchain",
    name: "My Blockchain Assets",
    description: "Get all blockchain assets (NFTs, tokens) owned by a wallet",
    parameters: [
      { name: "walletAddress", type: "string", required: true, description: "Wallet address" },
    ],
    channel: "subgraph:my-assets",
  },
  {
    id: "blockchain.tokens",
    category: "blockchain",
    name: "List Tokens",
    description: "List all tokens in the marketplace",
    parameters: [],
    channel: "subgraph:tokens",
  },
  {
    id: "blockchain.user_balances",
    category: "blockchain",
    name: "User Token Balances",
    description: "Get token balances for a wallet address",
    parameters: [
      { name: "walletAddress", type: "string", required: true, description: "Wallet address" },
    ],
    channel: "subgraph:user-balances",
  },
  {
    id: "blockchain.purchases",
    category: "blockchain",
    name: "User Purchases",
    description: "Get purchase history for a wallet",
    parameters: [
      { name: "walletAddress", type: "string", required: true, description: "Wallet address" },
    ],
    channel: "subgraph:purchases",
  },
  {
    id: "blockchain.marketplace_listings",
    category: "blockchain",
    name: "Marketplace Listings",
    description: "Browse active marketplace listings on-chain",
    parameters: [],
    channel: "subgraph:marketplace-listings",
  },
  {
    id: "blockchain.marketplace_stats",
    category: "blockchain",
    name: "Marketplace Stats",
    description: "Get overall marketplace statistics (volume, sales, listings)",
    parameters: [],
    channel: "subgraph:marketplace-stats",
  },
  {
    id: "blockchain.all_stores",
    category: "blockchain",
    name: "List All Stores",
    description: "List all stores on the marketplace",
    parameters: [],
    channel: "subgraph:all-stores",
  },
  {
    id: "blockchain.store_stats",
    category: "blockchain",
    name: "Store Statistics",
    description: "Get aggregated store statistics",
    parameters: [],
    channel: "subgraph:store-stats",
  },

  // ── Decentralized Deployment ──
  {
    id: "decentralized_deploy.get_platforms",
    category: "decentralized_deploy",
    name: "Get Deploy Platforms",
    description: "List available decentralized deployment platforms (IPFS, Arweave, Spheron)",
    parameters: [],
    channel: "decentralized:get-platforms",
  },

  // ── Extended Workflow (n8n) ──
  {
    id: "workflow.get",
    category: "workflow",
    name: "Get Workflow",
    description: "Get details of a specific n8n workflow",
    parameters: [
      { name: "id", type: "string", required: true, description: "Workflow ID" },
    ],
    channel: "n8n:workflow:get",
    positional: true,
  },
  {
    id: "workflow.update",
    category: "workflow",
    name: "Update Workflow",
    description: "Update an existing n8n workflow",
    parameters: [
      { name: "id", type: "string", required: true, description: "Workflow ID" },
      { name: "data", type: "object", required: true, description: "Updated workflow data" },
    ],
    channel: "n8n:workflow:update",
  },
  {
    id: "workflow.delete",
    category: "workflow",
    name: "Delete Workflow",
    description: "Delete an n8n workflow",
    parameters: [
      { name: "id", type: "string", required: true, description: "Workflow ID" },
    ],
    channel: "n8n:workflow:delete",
    positional: true,
  },
  {
    id: "workflow.activate",
    category: "workflow",
    name: "Activate Workflow",
    description: "Activate an n8n workflow so it runs on triggers",
    parameters: [
      { name: "id", type: "string", required: true, description: "Workflow ID" },
    ],
    channel: "n8n:workflow:activate",
    positional: true,
  },
  {
    id: "workflow.deactivate",
    category: "workflow",
    name: "Deactivate Workflow",
    description: "Deactivate an n8n workflow",
    parameters: [
      { name: "id", type: "string", required: true, description: "Workflow ID" },
    ],
    channel: "n8n:workflow:deactivate",
    positional: true,
  },

  // ── Extended Skill ──
  {
    id: "skill.create",
    category: "skill",
    name: "Create Skill",
    description: "Create a new reusable skill",
    parameters: [
      { name: "name", type: "string", required: true, description: "Skill name" },
      { name: "description", type: "string", required: true, description: "Skill description" },
    ],
    channel: "skill:create",
  },
  {
    id: "skill.delete",
    category: "skill",
    name: "Delete Skill",
    description: "Delete a skill",
    parameters: [
      { name: "skillId", type: "number", required: true, description: "Skill ID" },
    ],
    channel: "skill:delete",
  },
  {
    id: "skill.publish",
    category: "skill",
    name: "Publish Skill",
    description: "Publish a skill for others to use",
    parameters: [
      { name: "skillId", type: "number", required: true, description: "Skill ID" },
    ],
    channel: "skill:publish",
  },

  // ── Extended App ──
  {
    id: "app.set_env",
    category: "app",
    name: "Set App Environment Variables",
    description: "Set environment variables for an app",
    parameters: [
      { name: "appId", type: "string", required: true, description: "The app ID" },
      { name: "envVars", type: "object", required: true, description: "Array of {key, value} pairs" },
    ],
    channel: "set-app-env-vars",
  },
  {
    id: "app.get_version",
    category: "app",
    name: "Get App Version",
    description: "Get the current JoyCreate application version",
    parameters: [],
    channel: "get-app-version",
  },
];

// ── Dispatch Engine ────────────────────────────────────────────────────────

/**
 * Execute an action by invoking its registered IPC handler directly
 * from the main process (no round-trip through renderer/preload).
 */
export async function dispatchAction(
  actionId: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const action = ACTION_CATALOG.find((a) => a.id === actionId);
  if (!action) {
    throw new Error(`Unknown action: ${actionId}`);
  }

  // Validate required parameters
  for (const p of action.parameters) {
    if (p.required && !(p.name in params)) {
      throw new Error(`Missing required parameter '${p.name}' for action '${actionId}'`);
    }
  }

  logger.info(`Dispatching action: ${actionId}`, { channel: action.channel });

  // Call the registered IPC handler directly from main process.
  const result = await invokeHandler(action.channel, params, action.parameters);

  logger.info(`Action ${actionId} completed`, {
    channel: action.channel,
    success: true,
  });

  return result;
}

/**
 * Invoke an IPC handler directly from the main process.
 *
 * We use Electron's internal handler registry. The handlers were registered
 * via `ipcMain.handle(channel, handler)`. We can call them by emitting
 * a synthetic invoke on the channel.
 *
 * Fallback: For channels that need special handling (like streaming),
 * we use channel-specific logic.
 */
async function invokeHandler(
  channel: string,
  params: Record<string, unknown>,
  paramDefs: ActionDefinition["parameters"] = [],
): Promise<unknown> {
  // Headless code generation — replaces the old stub that routed to mission:start
  if (channel === "chat:stream") {
    logger.info("chat:stream headless — generating code directly via AI SDK");

    const chatId = params.chatId as number | undefined;
    const prompt = params.prompt as string | undefined;
    if (!chatId || !prompt) {
      throw new Error("chat:stream headless requires chatId and prompt");
    }

    const { db } = await import("@/db");
    const { chats, messages } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { getJoyAppPath } = await import("@/paths/paths");
    const { extractCodebase } = await import("@/utils/codebase");
    const {
      constructSystemPrompt,
      readAiRules,
    } = await import("@/prompts/system_prompt");
    const {
      processFullResponseActions,
    } = await import("@/ipc/processors/response_processor");
    const {
      convertMarkdownCodeBlocksToJoyWrite,
    } = await import("@/ipc/utils/markdown_to_joy_write");
    const { generateText } = await import("ai");
    const { getModelClient } = await import("@/ipc/utils/get_model_client");
    const { readSettings } = await import("@/main/settings");

    // Load the chat with its app
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      with: { app: true },
    });
    if (!chat?.app) {
      throw new Error(`No app found for chat ${chatId}`);
    }

    const appPath = getJoyAppPath(chat.app.path);
    const settings = readSettings();

    // Extract codebase for context
    const codebase = await extractCodebase({
      appPath,
      chatContext: {
        contextPaths: [],
        smartContextAutoIncludes: [],
        excludePaths: [],
      },
    });

    // Build system prompt
    const aiRules = await readAiRules(appPath);
    const systemPrompt = constructSystemPrompt({
      aiRules,
      chatMode: "build",
      enableTurboEditsV2: false,
    });

    // Insert user message into chat history
    const [userMsg] = await db
      .insert(messages)
      .values({ chatId, role: "user", content: prompt })
      .returning();

    // Insert placeholder assistant message
    const [assistantMsg] = await db
      .insert(messages)
      .values({ chatId, role: "assistant", content: "" })
      .returning();

    // Build the full prompt with codebase context
    const fullPrompt = codebase.formattedOutput
      ? `Here is the current codebase:\n\n${codebase.formattedOutput}\n\nUser request: ${prompt}`
      : prompt;

    // Call AI
    const selectedModel = settings.selectedModel;
    const { modelClient } = await getModelClient(selectedModel, settings);

    const result = await generateText({
      model: modelClient.model,
      system: systemPrompt,
      prompt: fullPrompt,
      maxOutputTokens: 65536,
    });

    let fullResponse = result.text;
    fullResponse = convertMarkdownCodeBlocksToJoyWrite(fullResponse);

    // Save the assistant response
    await db
      .update(messages)
      .set({ content: fullResponse, model: selectedModel?.name ?? null })
      .where(eq(messages.id, assistantMsg.id));

    // Apply joy-write tags to the filesystem
    const status = await processFullResponseActions(fullResponse, chatId, {
      chatSummary: undefined,
      messageId: assistantMsg.id,
    });

    logger.info("Headless code generation complete", {
      chatId,
      updatedFiles: status.updatedFiles ?? false,
      error: status.error,
    });

    return {
      chatId,
      generated: true,
      updatedFiles: status.updatedFiles ?? false,
      error: status.error,
    };
  }

  // ── libreoffice:create — reshape flat params into CreateDocumentRequest ──
  if (channel === "libreoffice:create") {
    const prompt = params.prompt as string | undefined;
    const request: Record<string, unknown> = {
      name: params.name,
      type: params.type,
    };
    if (prompt) {
      request.aiGenerate = {
        prompt,
        tone: params.tone || "professional",
        length: params.length || "detailed",
        routingMode: "smart" as const,
      };
    }

    const handler = (ipcMain as any)._invokeHandlers?.get(channel);
    if (handler) {
      return handler({} as Electron.IpcMainInvokeEvent, request);
    }
    const handlers = getHandlerMap();
    const fn = handlers?.get(channel);
    if (fn) {
      return fn({} as Electron.IpcMainInvokeEvent, request);
    }
    throw new Error(`No handler registered for channel: ${channel}`);
  }

  // Build the argument list.
  // Most IPC handlers accept a single params object (e.g. deploy:auto-deploy).
  // A few accept positional args (e.g. create-chat expects (_, appId)).
  // Use the `positional` flag from the action definition to decide.
  const actionDef = ACTION_CATALOG.find((a) => a.channel === channel);
  const isPositional = actionDef?.positional === true;
  const spreadArgs = isPositional && paramDefs.length > 0
    ? paramDefs.map((p) => params[p.name])
    : [params]; // Default: pass entire object

  const handler = (ipcMain as any)._invokeHandlers?.get(channel);
  if (handler) {
    return handler({} as Electron.IpcMainInvokeEvent, ...spreadArgs);
  }

  // Fallback: try the internal Map (Electron >=28)
  try {
    const handlers = getHandlerMap();
    const fn = handlers?.get(channel);
    if (fn) {
      return fn({} as Electron.IpcMainInvokeEvent, ...spreadArgs);
    }
  } catch {
    // Ignore
  }

  throw new Error(`No handler registered for channel: ${channel}`);
}

/**
 * Get Electron's internal IPC handler map.
 * This is an implementation detail but stable across Electron versions.
 */
function getHandlerMap(): Map<string, Function> | null {
  // Try known internal properties
  const target = ipcMain as any;

  // Electron stores handlers in _invokeHandlers (most versions)
  if (target._invokeHandlers instanceof Map) {
    return target._invokeHandlers;
  }

  // Some versions use a different path
  if (target._events?.["__ELECTRON_IPC_INVOKE__"]) {
    return null; // Can't extract individual handlers from this pattern
  }

  return null;
}

/**
 * Get the full action catalog for the AI to use as tool definitions.
 */
export function getActionCatalog(): ActionDefinition[] {
  return ACTION_CATALOG;
}

/**
 * Get action catalog formatted as tool descriptions for the AI planner.
 */
export function getActionCatalogForPlanner(): string {
  const grouped: Record<string, ActionDefinition[]> = {};
  for (const action of ACTION_CATALOG) {
    if (!grouped[action.category]) grouped[action.category] = [];
    grouped[action.category].push(action);
  }

  const lines: string[] = [];
  for (const [category, actions] of Object.entries(grouped)) {
    lines.push(`\n## ${category.toUpperCase()}`);
    for (const a of actions) {
      const paramStr = a.parameters.length
        ? a.parameters
            .map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type} — ${p.description}`)
            .join(", ")
        : "(no parameters)";
      lines.push(`- **${a.id}**: ${a.description} | Params: ${paramStr}`);
    }
  }

  return lines.join("\n");
}
