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
    id: "app.create_chat",
    category: "app",
    name: "Create App Chat",
    description: "Create a new chat session for an app to start building",
    parameters: [
      { name: "appId", type: "number", required: true, description: "The app ID" },
    ],
    channel: "create-chat",
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
      { name: "description", type: "string", required: true, description: "Agent purpose" },
      { name: "type", type: "string", required: true, description: "Agent type: assistant, coder, researcher, etc." },
      { name: "systemPrompt", type: "string", required: true, description: "System prompt" },
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
    channel: "vector-store:search",
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
  // ipcMain._invokeHandlers is not public, so we use the trick of
  // looking up the handler and calling it with a fake event.
  // Instead, we use a cleaner approach: invoke handlers are just
  // registered functions. We can call them through Electron's internal API
  // or — simpler and safer — re-dispatch via the handler map.
  const result = await invokeHandler(action.channel, params);

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
): Promise<unknown> {
  // For streaming channels we can't use standard invoke
  if (channel === "chat:stream") {
    // Streaming is fire-and-forget from the handler perspective.
    // We trigger it but can't get streamed output here.
    // The handler sends tokens via event.sender.send() which requires a BrowserWindow.
    // For autonomous execution, we note this as a limitation.
    logger.warn("chat:stream requires a renderer window for streaming output. Use mission:start for autonomous code generation.");
    throw new Error(
      "Direct code streaming requires a renderer window. " +
      "Use action 'mission.start' for autonomous code generation instead.",
    );
  }

  // Use Electron's internal handler invocation.
  // ipcMain.handle registers handlers that we can look up.
  // The cleanest way from main process is to emit a handle event.
  const handler = (ipcMain as any)._invokeHandlers?.get(channel);
  if (handler) {
    // Call with a null event (handlers that don't use event are safe)
    return handler({} as Electron.IpcMainInvokeEvent, params);
  }

  // Fallback: try calling via the internal Map
  // Electron stores handle callbacks in a Map.
  // If the internal API changed, we fall back to a direct require approach.
  try {
    // Electron >=28 uses _invokeHandlers Map on ipcMain
    const handlers = getHandlerMap();
    const fn = handlers?.get(channel);
    if (fn) {
      return fn({} as Electron.IpcMainInvokeEvent, params);
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
