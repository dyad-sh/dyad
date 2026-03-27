/**
 * Agent Sharing Handlers
 * Manage share configurations, generate share codes (widget/SDK/link/embed/iframe),
 * and save apps as agent templates.
 */

import { IpcMainInvokeEvent, ipcMain } from "electron";
import * as crypto from "crypto";
import log from "electron-log";
import { db } from "@/db";
import {
  agents,
  apps,
  agentShareConfigs,
  agentUIComponents,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  CreateShareConfigRequest,
  UpdateShareConfigRequest,
  ShareCodesResponse,
  SaveAppAsAgentTemplateRequest,
} from "@/types/agent_builder";

const logger = log.scope("agent_sharing");

// ============================================================================
// Create Share Config
// ============================================================================

async function handleCreateShareConfig(
  _event: IpcMainInvokeEvent,
  req: CreateShareConfigRequest,
): Promise<{ id: number; shareToken: string }> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, req.agentId),
  });
  if (!agent) throw new Error("Agent not found");

  const shareToken = crypto.randomBytes(16).toString("hex");

  const [row] = await db
    .insert(agentShareConfigs)
    .values({
      agentId: req.agentId,
      shareToken,
      title: req.title ?? agent.name,
      backendConfigJson: req.backendConfig ?? null,
      widgetConfigJson: req.widgetConfig ?? null,
      allowedDomains: req.allowedDomains ?? [],
      sourceAppId: req.sourceAppId ?? null,
    })
    .returning({ id: agentShareConfigs.id });

  logger.info(`Share config created for agent ${req.agentId}: ${shareToken}`);
  return { id: row.id, shareToken };
}

// ============================================================================
// Get Share Config
// ============================================================================

async function handleGetShareConfig(
  _event: IpcMainInvokeEvent,
  agentId: number,
) {
  const row = await db.query.agentShareConfigs.findFirst({
    where: eq(agentShareConfigs.agentId, agentId),
  });
  if (!row) return null;
  return {
    id: row.id,
    agentId: row.agentId,
    shareToken: row.shareToken,
    enabled: row.enabled,
    title: row.title,
    backendConfig: row.backendConfigJson,
    widgetConfig: row.widgetConfigJson,
    allowedDomains: row.allowedDomains,
    liveUrl: row.liveUrl,
    sourceAppId: row.sourceAppId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ============================================================================
// Update Share Config
// ============================================================================

async function handleUpdateShareConfig(
  _event: IpcMainInvokeEvent,
  req: UpdateShareConfigRequest,
) {
  const existing = await db.query.agentShareConfigs.findFirst({
    where: eq(agentShareConfigs.id, req.id),
  });
  if (!existing) throw new Error("Share config not found");

  await db
    .update(agentShareConfigs)
    .set({
      ...(req.enabled !== undefined && { enabled: req.enabled }),
      ...(req.title !== undefined && { title: req.title }),
      ...(req.backendConfig !== undefined && {
        backendConfigJson: req.backendConfig,
      }),
      ...(req.widgetConfig !== undefined && {
        widgetConfigJson: req.widgetConfig,
      }),
      ...(req.allowedDomains !== undefined && {
        allowedDomains: req.allowedDomains,
      }),
      ...(req.liveUrl !== undefined && { liveUrl: req.liveUrl }),
      updatedAt: new Date(),
    })
    .where(eq(agentShareConfigs.id, req.id));

  return { success: true };
}

// ============================================================================
// Delete Share Config
// ============================================================================

async function handleDeleteShareConfig(
  _event: IpcMainInvokeEvent,
  shareConfigId: number,
) {
  await db
    .delete(agentShareConfigs)
    .where(eq(agentShareConfigs.id, shareConfigId));
  return { success: true };
}

// ============================================================================
// Generate Share Codes (widget, SDK, link, embed, iframe)
// ============================================================================

async function handleGenerateShareCodes(
  _event: IpcMainInvokeEvent,
  agentId: number,
): Promise<ShareCodesResponse> {
  const config = await db.query.agentShareConfigs.findFirst({
    where: eq(agentShareConfigs.agentId, agentId),
  });
  if (!config) throw new Error("Share config not found. Create one first.");

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });
  if (!agent) throw new Error("Agent not found");

  const baseUrl =
    config.liveUrl ??
    config.backendConfigJson?.apiEndpoint ??
    `http://localhost:${config.backendConfigJson?.port ?? 3001}`;

  const agentName = config.title ?? agent.name ?? "AI Assistant";
  const token = config.shareToken;
  const wc = config.widgetConfigJson;

  // 1. Widget — floating chat bubble script tag
  const widget = `<!-- ${agentName} Chat Widget -->
<script
  src="${baseUrl}/widget.js"
  data-agent-token="${token}"
  data-position="${wc?.position ?? "bottom-right"}"
  data-primary-color="${wc?.primaryColor ?? "#6366f1"}"
  data-width="${wc?.width ?? 400}"
  data-height="${wc?.height ?? 600}"
  async
></script>`;

  // 2. SDK — JavaScript module import
  const sdk = `// ${agentName} SDK
import { JoyAgent } from "${baseUrl}/sdk.js";

const agent = new JoyAgent({
  token: "${token}",
  baseUrl: "${baseUrl}",
});

// Send a message
const response = await agent.chat("Hello!");
console.log(response.content);

// Stream a response
for await (const chunk of agent.chatStream("Tell me a story")) {
  process.stdout.write(chunk);
}`;

  // 3. Link — direct shareable URL
  const link = `${baseUrl}/chat/${token}`;

  // 4. Embed — inline div + script
  const embed = `<!-- ${agentName} Embedded Chat -->
<div id="joycreate-agent-${token}" style="width:${wc?.width ?? 400}px;height:${wc?.height ?? 600}px;"></div>
<script>
(function(){
  var c=document.getElementById("joycreate-agent-${token}");
  var f=document.createElement("iframe");
  f.src="${baseUrl}/chat/${token}?embed=true";
  f.style.cssText="width:100%;height:100%;border:none;border-radius:12px;";
  f.allow="clipboard-write";
  c.appendChild(f);
})();
</script>`;

  // 5. Iframe — raw iframe tag
  const iframe = `<iframe
  src="${baseUrl}/chat/${token}?embed=true"
  width="${wc?.width ?? 400}"
  height="${wc?.height ?? 600}"
  style="border:none;border-radius:12px;"
  allow="clipboard-write"
  title="${agentName}"
></iframe>`;

  return { widget, sdk, link, embed, iframe };
}

// ============================================================================
// Save App as Agent Template
// ============================================================================

async function handleSaveAppAsAgentTemplate(
  _event: IpcMainInvokeEvent,
  req: SaveAppAsAgentTemplateRequest,
): Promise<{ agentId: number; shareToken: string }> {
  // Validate app exists
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, req.appId),
  });
  if (!app) throw new Error("App not found");

  // Create agent linked to the app
  const [agent] = await db
    .insert(agents)
    .values({
      name: req.agentName,
      description: req.agentDescription ?? app.name,
      type: req.agentType ?? "chatbot",
      status: "draft",
      appId: req.appId,
      systemPrompt: req.systemPrompt ?? null,
    })
    .returning({ id: agents.id });

  // Auto-create share config
  const shareToken = crypto.randomBytes(16).toString("hex");
  await db.insert(agentShareConfigs).values({
    agentId: agent.id,
    shareToken,
    title: req.agentName,
    sourceAppId: req.appId,
    allowedDomains: [],
  });

  logger.info(
    `App ${req.appId} saved as agent template ${agent.id} (${req.agentName})`,
  );
  return { agentId: agent.id, shareToken };
}

// ============================================================================
// Register Handlers
// ============================================================================

export function registerAgentSharingHandlers(): void {
  ipcMain.handle("agent:share:create", handleCreateShareConfig);
  ipcMain.handle("agent:share:get", handleGetShareConfig);
  ipcMain.handle("agent:share:update", handleUpdateShareConfig);
  ipcMain.handle("agent:share:delete", handleDeleteShareConfig);
  ipcMain.handle("agent:share:generate-codes", handleGenerateShareCodes);
  ipcMain.handle(
    "agent:share:save-app-as-template",
    handleSaveAppAsAgentTemplate,
  );

  logger.info("Agent sharing handlers registered");
}
