/**
 * JoyCreate API Server
 *
 * Lightweight HTTP server that exposes JoyCreate operations to external
 * callers (e.g. OpenClaw agent via tool plugins). Runs on port 18793
 * and requires a bearer token for authentication.
 *
 * The token is written to ~/.openclaw/joycreate-api-token on startup
 * so the OpenClaw plugin can read it automatically.
 */

import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { app } from "electron";
import log from "electron-log";

import { ipcMain } from "electron";
import { getDb } from "@/db/index";
import { projects, apps, agents, chats, messages } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getTailscaleConfig } from "./tailscale_service";

const logger = log.scope("joycreate-api");

const API_PORT = 18793;
const TOKEN_FILE = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".openclaw",
  "joycreate-api-token",
);

let server: http.Server | null = null;
let apiToken: string | null = null;

// ---------------------------------------------------------------------------
// Bridge token push — automatically sends the fresh token to the OpenClaw bot
// so you never need to copy-paste it manually after a restart.
// Set BRIDGE_TOKEN_URL env var to override the default endpoint.
// Set BRIDGE_API_KEY env var to add Bearer auth to the push request.
// ---------------------------------------------------------------------------
const BRIDGE_TOKEN_URL =
  process.env.BRIDGE_TOKEN_URL || "https://api.clawelite.io/bridge/update-token";
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || "";

async function pushTokenToBridge(token: string): Promise<void> {
  const hostname = require("node:os").hostname();
  const payload = JSON.stringify({
    token,
    machineId: hostname,
    source: "joycreate",
    port: API_PORT,
    timestamp: new Date().toISOString(),
  });

  const url = new URL(BRIDGE_TOKEN_URL);
  const transport = url.protocol === "https:" ? https : http;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(payload)),
  };
  if (BRIDGE_API_KEY) {
    headers["Authorization"] = `Bearer ${BRIDGE_API_KEY}`;
  }

  return new Promise((resolve) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers,
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            logger.info(`Token pushed to bridge (${res.statusCode})`);
          } else {
            logger.warn(`Bridge returned HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString()}`);
          }
          resolve();
        });
      },
    );
    req.on("error", (err) => {
      logger.warn(`Bridge push failed: ${err.message}`);
      resolve(); // non-blocking — don't prevent server from starting
    });
    req.on("timeout", () => {
      logger.warn("Bridge push timed out");
      req.destroy();
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function error(res: http.ServerResponse, msg: string, status = 400) {
  json(res, { error: msg }, status);
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleListProjects(_body: Record<string, unknown>) {
  const db = getDb();
  const rows = await db.select().from(projects).all();
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    icon: p.icon,
    tags: p.tags || [],
    isFavorite: Boolean(p.isFavorite),
  }));
}

async function handleCreateProject(body: Record<string, unknown>) {
  const name = body.name as string;
  if (!name) throw new Error("name is required");

  const { createProject } = await import("@/ipc/handlers/project_handlers");
  return createProject({
    name,
    description: (body.description as string) || undefined,
    color: (body.color as string) || undefined,
    icon: (body.icon as string) || undefined,
    tags: (body.tags as string[]) || undefined,
  });
}

async function handleListAgents(_body: Record<string, unknown>) {
  const db = getDb();
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      type: agents.type,
      status: agents.status,
      modelId: agents.modelId,
      version: agents.version,
      publishStatus: agents.publishStatus,
    })
    .from(agents)
    .orderBy(desc(agents.updatedAt))
    .all();
  return rows;
}

async function handleCreateAgent(body: Record<string, unknown>) {
  const name = body.name as string;
  if (!name) throw new Error("name is required");

  const db = getDb();
  const [agent] = await db
    .insert(agents)
    .values({
      name,
      description: (body.description as string) || null,
      type: (body.type as string) || "chatbot",
      systemPrompt: (body.systemPrompt as string) || null,
      modelId: (body.modelId as string) || null,
      status: "draft",
      version: "1.0.0",
    })
    .returning();

  return { id: agent.id, name: agent.name, type: agent.type, status: "draft" };
}

async function handleListApps(_body: Record<string, unknown>) {
  const db = getDb();
  const rows = await db
    .select({
      id: apps.id,
      name: apps.name,
      projectId: apps.projectId,
      isFavorite: apps.isFavorite,
    })
    .from(apps)
    .orderBy(desc(apps.updatedAt))
    .all();
  return rows;
}

async function handleMarketplaceStatus(_body: Record<string, unknown>) {
  try {
    // Dynamic import to avoid coupling at startup
    const mod = await import("@/ipc/handlers/marketplace_handlers");
    // The status handler is registered on ipcMain;
    // we replicate the check inline since the function isn't exported.
    return { connected: false, note: "Check marketplace connection from JoyCreate UI" };
  } catch {
    return { connected: false };
  }
}

async function handlePublishAgent(body: Record<string, unknown>) {
  const agentId = Number(body.agentId);
  if (!agentId) throw new Error("agentId is required");

  const name = body.name as string;
  if (!name) throw new Error("name is required");

  const description = (body.description as string) || "";
  const shortDescription = (body.shortDescription as string) || description.slice(0, 120);
  const category = (body.category as string) || "ai-agents";
  const tags = (body.tags as string[]) || [];
  const version = (body.version as string) || "1.0.0";
  const pricingModel = (body.pricingModel as string) || "free";
  const license = (body.license as string) || "MIT";

  // We invoke ipcMain.handle() internally via Electron's IPC mechanism
  // but since we're in the main process, call the handler directly if possible.
  // For agent publishing, the handler is registered on ipcMain and not exported.
  // We simulate the invoke:
  const { ipcMain } = await import("electron");

  // Use internal emit to invoke the handler
  return new Promise((resolve, reject) => {
    const fakeEvent = { sender: { isDestroyed: () => false } } as Electron.IpcMainInvokeEvent;
    const payload = {
      assetType: "agent",
      sourceId: agentId,
      name,
      shortDescription,
      description,
      category,
      tags,
      pricingModel,
      price: Number(body.price) || 0,
      license,
      version,
    };

    // Access the registered handler through Electron internals
    const handler = (ipcMain as unknown as { _invokeHandlers?: Map<string, Function> })
      ._invokeHandlers?.get("agent:publish-to-marketplace");

    if (handler) {
      handler(fakeEvent, payload).then(resolve).catch(reject);
    } else {
      reject(new Error("Publish handler not registered. Ensure JoyCreate is fully loaded."));
    }
  });
}

async function handleGetAgent(body: Record<string, unknown>) {
  const agentId = Number(body.agentId);
  if (!agentId) throw new Error("agentId is required");

  const db = getDb();
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    type: agent.type,
    status: agent.status,
    systemPrompt: agent.systemPrompt,
    modelId: agent.modelId,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    version: agent.version,
    publishStatus: agent.publishStatus,
    marketplaceId: agent.marketplaceId,
  };
}

// ---------------------------------------------------------------------------
// Builder API handlers
// ---------------------------------------------------------------------------

/**
 * Invoke a registered ipcMain handle handler from within the main process.
 * Uses Electron's internal _invokeHandlers map.
 */
function invokeIpcHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Function> })
    ._invokeHandlers;
  const handler = handlers?.get(channel);
  if (!handler) {
    throw new Error(`IPC handler not registered: ${channel}`);
  }
  // Create a minimal fake event; the handler expects event as first arg
  const fakeEvent = {
    sender: {
      isDestroyed: () => false,
      send: () => {},
    },
  } as unknown as Electron.IpcMainInvokeEvent;
  return handler(fakeEvent, ...args);
}

/**
 * For chat:stream we need a special sender that collects streamed events
 * and resolves when the stream ends.
 */
function invokeChatStream(params: {
  chatId: number;
  prompt: string;
}): Promise<{
  response: string;
  updatedFiles: boolean;
  error?: string;
}> {
  return new Promise((resolve, reject) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Function> })
      ._invokeHandlers;
    const handler = handlers?.get("chat:stream");
    if (!handler) {
      return reject(new Error("chat:stream handler not registered"));
    }

    let fullResponse = "";
    let streamError: string | undefined;
    let updatedFiles = false;
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ response: fullResponse || "(timeout)", updatedFiles, error: "Stream timed out after 5 minutes" });
      }
    }, 5 * 60 * 1000);

    const fakeSender = {
      isDestroyed: () => false,
      send: (channel: string, data: unknown) => {
        const d = data as Record<string, unknown>;
        if (channel === "chat:response:chunk" && d.messages) {
          // Extract latest assistant message content
          const msgs = d.messages as Array<{ role: string; content: string }>;
          const last = msgs.filter((m) => m.role === "assistant").pop();
          if (last) fullResponse = last.content;
        } else if (channel === "chat:response:error") {
          streamError = (d.error as string) || "Unknown error";
        } else if (channel === "chat:response:end") {
          updatedFiles = Boolean(d.updatedFiles);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve({ response: fullResponse, updatedFiles, error: streamError });
          }
        }
      },
    };

    const fakeEvent = { sender: fakeSender } as unknown as Electron.IpcMainInvokeEvent;
    handler(fakeEvent, params).catch((err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

async function handleCreateApp(body: Record<string, unknown>) {
  const name = body.name as string;
  if (!name) throw new Error("name is required");

  const result = (await invokeIpcHandler("create-app", { name })) as {
    app: { id: number; name: string; path: string };
    chatId: number;
  };

  return {
    appId: result.app.id,
    appName: result.app.name,
    appPath: result.app.path,
    chatId: result.chatId,
  };
}

async function handleBuildApp(body: Record<string, unknown>) {
  const appId = Number(body.appId);
  const prompt = body.prompt as string;
  if (!appId) throw new Error("appId is required");
  if (!prompt) throw new Error("prompt is required");

  const db = getDb();

  // Find the chat for this app (use the most recent one, or a specific chatId)
  let chatId = Number(body.chatId) || 0;
  if (!chatId) {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.appId, appId),
      orderBy: (chats, { desc }) => [desc(chats.createdAt)],
    });
    if (!chat) throw new Error(`No chat found for app ${appId}`);
    chatId = chat.id;
  }

  // Enrich the prompt with year context for API callers
  const currentYear = new Date().getFullYear();
  const enrichedPrompt = `[Context: The current year is ${currentYear}. Use ${currentYear} for all dates, model years, and references — never 2024 or 2025. Implement fully — no placeholders or TODOs.]\n\n${prompt}`;

  // Invoke the chat stream — this is the core builder
  const result = await invokeChatStream({ chatId, prompt: enrichedPrompt });

  return {
    chatId,
    updatedFiles: result.updatedFiles,
    response: result.response,
    error: result.error,
  };
}

async function handleGetApp(body: Record<string, unknown>) {
  const appId = Number(body.appId);
  if (!appId) throw new Error("appId is required");

  const db = getDb();
  const [appRow] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
  if (!appRow) throw new Error(`App not found: ${appId}`);

  // Get the latest chat and its messages
  const latestChat = await db.query.chats.findFirst({
    where: eq(chats.appId, appId),
    orderBy: (chats, { desc }) => [desc(chats.createdAt)],
    with: {
      messages: {
        orderBy: (messages, { desc }) => [desc(messages.createdAt)],
        limit: 5,
      },
    },
  });

  return {
    id: appRow.id,
    name: appRow.name,
    path: appRow.path,
    projectId: appRow.projectId,
    vercelDeploymentUrl: appRow.vercelDeploymentUrl,
    vercelProjectName: appRow.vercelProjectName,
    isFavorite: appRow.isFavorite,
    createdAt: appRow.createdAt,
    updatedAt: appRow.updatedAt,
    chatId: latestChat?.id,
    chatTitle: latestChat?.title,
    recentMessages: latestChat?.messages.map((m) => ({
      role: m.role,
      content: m.content.substring(0, 500),
      createdAt: m.createdAt,
    })),
  };
}

async function handleRunApp(body: Record<string, unknown>) {
  const appId = Number(body.appId);
  if (!appId) throw new Error("appId is required");

  await invokeIpcHandler("run-app", { appId });
  return { appId, status: "running" };
}

async function handleStopApp(body: Record<string, unknown>) {
  const appId = Number(body.appId);
  if (!appId) throw new Error("appId is required");

  await invokeIpcHandler("stop-app", { appId });
  return { appId, status: "stopped" };
}

async function handleDeployAgent(body: Record<string, unknown>) {
  const agentId = Number(body.agentId);
  if (!agentId) throw new Error("agentId is required");

  const target = (body.target as string) || "local";
  const validTargets = ["local", "docker", "vercel", "aws", "ipfs", "custom"];
  if (!validTargets.includes(target)) {
    throw new Error(`Invalid target: ${target}. Must be one of: ${validTargets.join(", ")}`);
  }

  const result = await invokeIpcHandler("agent:deploy", {
    agentId,
    target,
    config: body.config || {},
  });

  return result;
}

async function handleUpdateAgent(body: Record<string, unknown>) {
  const agentId = Number(body.agentId);
  if (!agentId) throw new Error("agentId is required");

  const db = getDb();
  const [existing] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!existing) throw new Error(`Agent not found: ${agentId}`);

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.systemPrompt !== undefined) updates.systemPrompt = body.systemPrompt;
  if (body.modelId !== undefined) updates.modelId = body.modelId;
  if (body.type !== undefined) updates.type = body.type;
  if (body.status !== undefined) updates.status = body.status;
  if (body.temperature !== undefined) updates.temperature = body.temperature;
  if (body.maxTokens !== undefined) updates.maxTokens = body.maxTokens;

  if (Object.keys(updates).length === 0) {
    throw new Error("No fields to update");
  }

  const [updated] = await db
    .update(agents)
    .set(updates)
    .where(eq(agents.id, agentId))
    .returning();

  return {
    id: updated.id,
    name: updated.name,
    type: updated.type,
    status: updated.status,
    systemPrompt: updated.systemPrompt,
    modelId: updated.modelId,
  };
}

async function handleGenerateAgentPrompt(body: Record<string, unknown>) {
  const description = body.description as string;
  if (!description) throw new Error("description is required");

  const agentId = Number(body.agentId) || undefined;

  // Try using the IPC handler if available
  try {
    const result = await invokeIpcHandler("agent-builder:generate-system-prompt", {
      description,
      agentId,
    });
    return result;
  } catch {
    // Fallback: generate a basic system prompt from the description
    return {
      systemPrompt: `You are an AI assistant specialized in: ${description}\n\nKey behaviors:\n- Be helpful, accurate, and concise\n- Follow the user's instructions carefully\n- If unsure, ask for clarification\n- Maintain a professional and friendly tone`,
    };
  }
}

async function handleCreateAndBuildApp(body: Record<string, unknown>) {
  const name = body.name as string;
  const prompt = body.prompt as string;
  if (!name) throw new Error("name is required");
  if (!prompt) throw new Error("prompt is required (describe what to build)");

  // Step 1: Create the app
  const createResult = (await invokeIpcHandler("create-app", { name })) as {
    app: { id: number; name: string; path: string };
    chatId: number;
  };

  // Step 2: Enrich the prompt — external callers (OpenClaw daemon) often send
  // thin descriptions. Wrap them with explicit builder instructions so the AI
  // generates a complete, production-quality app on the first pass.
  const currentYear = new Date().getFullYear();
  const enrichedPrompt = [
    `# Build Request: ${name}`,
    ``,
    `## IMPORTANT CONTEXT`,
    `- The current year is ${currentYear}. Use ${currentYear} dates, model years, and references everywhere — never use outdated years like 2024 or 2025.`,
    `- Build a COMPLETE, fully-functional application — not a skeleton or demo.`,
    `- Implement EVERY feature described below with real UI, real state management, real routing, and real interactivity.`,
    `- Use modern, visually polished design with proper spacing, typography, animations, and responsive layouts.`,
    `- Include realistic sample/seed data so the app looks populated and professional on first load.`,
    `- Wire up all navigation, forms, modals, filters, search, and CRUD operations end-to-end.`,
    ``,
    `## APP DESCRIPTION`,
    prompt,
    ``,
    `## IMPLEMENTATION REQUIREMENTS`,
    `- Create ALL pages and components referenced in the description.`,
    `- Every button, link, and action must be wired up and functional.`,
    `- Forms must validate input and show success/error feedback.`,
    `- Use localStorage or in-memory state so the app is fully interactive without a backend.`,
    `- Include at least 5-10 realistic sample records per data type (e.g. products, users, orders).`,
    `- Apply consistent theming: if custom colors are specified, use them throughout.`,
    `- Add subtle animations and transitions for a polished feel.`,
  ].join("\n");

  // Step 3: Send the enriched build prompt
  const buildResult = await invokeChatStream({
    chatId: createResult.chatId,
    prompt: enrichedPrompt,
  });

  return {
    appId: createResult.app.id,
    appName: createResult.app.name,
    appPath: createResult.app.path,
    chatId: createResult.chatId,
    updatedFiles: buildResult.updatedFiles,
    buildResponse: buildResult.response,
    buildError: buildResult.error,
  };
}

async function handleNlpCreateAgent(body: Record<string, unknown>) {
  const description = body.description as string;
  if (!description) throw new Error("description is required (describe the agent you want)");

  // Use the full NLP pipeline: detect intent → generate blueprint → create agent
  try {
    const result = await invokeIpcHandler("agent:pipeline:detect-and-generate", {
      input: description,
    });
    return result;
  } catch {
    // Fallback: manual creation with generated prompt
    const promptResult = (await handleGenerateAgentPrompt({ description })) as {
      systemPrompt: string;
    };
    const createResult = await handleCreateAgent({
      name: description.split(/[.!?]/)[0].trim().substring(0, 50) || "New Agent",
      description,
      type: (body.type as string) || "chatbot",
      systemPrompt: promptResult.systemPrompt,
      modelId: body.modelId,
    });
    return createResult;
  }
}

// ---------------------------------------------------------------------------
// Email API handlers
// ---------------------------------------------------------------------------

async function handleEmailAccountList() {
  return invokeIpcHandler("email:account:list");
}

async function handleEmailFoldersList(body: Record<string, unknown>) {
  const accountId = body.accountId as string;
  if (!accountId) throw new Error("accountId is required");
  return invokeIpcHandler("email:folders:list", accountId);
}

async function handleEmailMessagesList(body: Record<string, unknown>) {
  const accountId = body.accountId as string;
  const folder = (body.folder as string) || "INBOX";
  const limit = Number(body.limit) || 20;
  const offset = Number(body.offset) || 0;

  if (accountId) {
    return invokeIpcHandler("email:messages:list", accountId, folder, { limit, offset });
  }
  // Unified view across all accounts
  return invokeIpcHandler("email:messages:list-unified", folder, { limit, offset });
}

async function handleEmailMessageGet(body: Record<string, unknown>) {
  const messageId = Number(body.messageId);
  if (!messageId) throw new Error("messageId is required");
  return invokeIpcHandler("email:messages:get", messageId);
}

async function handleEmailSearch(body: Record<string, unknown>) {
  const query: Record<string, unknown> = {};
  if (body.folder) query.folder = body.folder;
  if (body.subject) query.subject = body.subject;
  if (body.isUnread !== undefined) query.isUnread = body.isUnread;
  if (body.aiCategory) query.aiCategory = body.aiCategory;
  if (body.limit) query.limit = Number(body.limit);
  if (body.offset) query.offset = Number(body.offset);
  return invokeIpcHandler("email:messages:search", query);
}

async function handleEmailSend(body: Record<string, unknown>) {
  const accountId = body.accountId as string;
  if (!accountId) throw new Error("accountId is required");

  const draft = {
    accountId,
    to: body.to as string[],
    cc: (body.cc as string[]) || [],
    bcc: (body.bcc as string[]) || [],
    subject: body.subject as string,
    body: body.body as string,
    bodyHtml: body.bodyHtml as string | undefined,
    inReplyTo: body.inReplyTo as string | undefined,
    parentMessageId: body.parentMessageId as number | undefined,
    aiGenerated: false,
  };
  if (!draft.to?.length) throw new Error("to is required (array of email addresses)");
  if (!draft.subject) throw new Error("subject is required");
  if (!draft.body) throw new Error("body is required");

  return invokeIpcHandler("email:send", accountId, draft);
}

async function handleEmailMarkRead(body: Record<string, unknown>) {
  const messageId = Number(body.messageId);
  if (!messageId) throw new Error("messageId is required");
  const read = body.read !== false; // default true
  await invokeIpcHandler("email:messages:mark-read", messageId, read);
  return { messageId, isRead: read };
}

async function handleEmailMove(body: Record<string, unknown>) {
  const messageId = Number(body.messageId);
  const toFolder = body.toFolder as string;
  if (!messageId) throw new Error("messageId is required");
  if (!toFolder) throw new Error("toFolder is required");
  await invokeIpcHandler("email:messages:move", messageId, toFolder);
  return { messageId, movedTo: toFolder };
}

async function handleEmailDelete(body: Record<string, unknown>) {
  const messageId = Number(body.messageId);
  if (!messageId) throw new Error("messageId is required");
  await invokeIpcHandler("email:messages:delete", messageId);
  return { messageId, deleted: true };
}

async function handleEmailAiCompose(body: Record<string, unknown>) {
  const accountId = body.accountId as string;
  if (!accountId) throw new Error("accountId is required");

  const request = {
    intent: body.intent as string,
    to: body.to as string | undefined,
    context: body.context as string | undefined,
    tone: body.tone as string | undefined,
    replyToMessageId: body.replyToMessageId as number | undefined,
  };
  if (!request.intent) throw new Error("intent is required (describe what to write)");

  return invokeIpcHandler("email:ai:compose", accountId, request);
}

async function handleEmailAiSmartReplies(body: Record<string, unknown>) {
  const messageId = Number(body.messageId);
  if (!messageId) throw new Error("messageId is required");
  return invokeIpcHandler("email:ai:smart-replies", messageId);
}

async function handleEmailAiTriage(body: Record<string, unknown>) {
  const messageId = Number(body.messageId);
  if (messageId) {
    return invokeIpcHandler("email:ai:triage", messageId);
  }
  const messageIds = body.messageIds as number[];
  if (!messageIds?.length) throw new Error("messageId or messageIds is required");
  return invokeIpcHandler("email:ai:triage-batch", messageIds);
}

async function handleEmailAiSummarize(body: Record<string, unknown>) {
  const messageIds = body.messageIds as number[];
  if (!messageIds?.length) throw new Error("messageIds is required (array of message IDs)");
  return invokeIpcHandler("email:ai:summarize", messageIds);
}

async function handleEmailAiDailyDigest() {
  return invokeIpcHandler("email:ai:daily-digest");
}

async function handleEmailAiAdjustTone(body: Record<string, unknown>) {
  const draft = body.draft as Record<string, unknown>;
  const tone = body.tone as string;
  if (!draft) throw new Error("draft is required");
  if (!tone) throw new Error("tone is required (formal, casual, friendly, urgent)");
  return invokeIpcHandler("email:ai:adjust-tone", draft, tone);
}

async function handleEmailSyncNow(body: Record<string, unknown>) {
  const accountId = body.accountId as string;
  if (!accountId) throw new Error("accountId is required");
  return invokeIpcHandler("email:sync:now", accountId);
}

async function handleEmailStats(body: Record<string, unknown>) {
  const accountId = body.accountId as string | undefined;
  return invokeIpcHandler("email:stats", accountId);
}

async function handleEmailReply(body: Record<string, unknown>) {
  const messageId = Number(body.messageId);
  const replyText = body.body as string;
  const accountId = body.accountId as string;
  if (!messageId) throw new Error("messageId is required");
  if (!replyText) throw new Error("body is required (the reply text)");

  // Get the original message to build the reply
  const original = (await invokeIpcHandler("email:messages:get", messageId)) as {
    id: number;
    accountId: string;
    from: string | string[];
    subject: string;
    remoteId: string;
  } | null;
  if (!original) throw new Error("Original message not found");

  const resolvedAccountId = accountId || original.accountId;
  const fromAddrs = Array.isArray(original.from) ? original.from : [original.from];

  const draft = {
    accountId: resolvedAccountId,
    to: fromAddrs,
    cc: (body.cc as string[]) || [],
    bcc: (body.bcc as string[]) || [],
    subject: original.subject.startsWith("Re:") ? original.subject : `Re: ${original.subject}`,
    body: replyText,
    inReplyTo: original.remoteId,
    parentMessageId: original.id,
    aiGenerated: false,
  };

  return invokeIpcHandler("email:send", resolvedAccountId, draft);
}

async function handleEmailAiReply(body: Record<string, unknown>) {
  const messageId = Number(body.messageId);
  const intent = body.intent as string;
  if (!messageId) throw new Error("messageId is required");
  if (!intent) throw new Error("intent is required (describe what to reply)");

  // Get the original message
  const original = (await invokeIpcHandler("email:messages:get", messageId)) as {
    id: number;
    accountId: string;
    from: string | string[];
    subject: string;
    remoteId: string;
  } | null;
  if (!original) throw new Error("Original message not found");

  // Use AI compose to generate the reply
  const aiDraft = (await invokeIpcHandler("email:ai:compose", original.accountId, {
    intent,
    replyToMessageId: messageId,
    tone: body.tone as string | undefined,
  })) as { body: string; subject: string };

  // If sendImmediately is set, send it right away
  if (body.send === true) {
    const fromAddrs = Array.isArray(original.from) ? original.from : [original.from];
    const draft = {
      accountId: original.accountId,
      to: fromAddrs,
      cc: [] as string[],
      bcc: [] as string[],
      subject: aiDraft.subject || (original.subject.startsWith("Re:") ? original.subject : `Re: ${original.subject}`),
      body: aiDraft.body,
      inReplyTo: original.remoteId,
      parentMessageId: original.id,
      aiGenerated: true,
    };
    const sent = await invokeIpcHandler("email:send", original.accountId, draft);
    return { sent: true, ...sent, draftBody: aiDraft.body };
  }

  return { sent: false, draft: aiDraft };
}

// ---------------------------------------------------------------------------
// Document Studio handlers
// ---------------------------------------------------------------------------

async function handleDocumentStatus() {
  return invokeIpcHandler("libreoffice:status");
}

async function handleDocumentList(body: Record<string, unknown>) {
  const query: Record<string, unknown> = {};
  if (body.type) query.type = body.type;
  if (body.status) query.status = body.status;
  if (body.search) query.search = body.search;
  if (body.tags) query.tags = body.tags;
  if (body.sortBy) query.sortBy = body.sortBy;
  if (body.sortOrder) query.sortOrder = body.sortOrder;
  if (body.limit) query.limit = body.limit;
  if (body.offset) query.offset = body.offset;
  return invokeIpcHandler("libreoffice:list", query);
}

async function handleDocumentGet(body: Record<string, unknown>) {
  const id = body.id as number;
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("libreoffice:get", id);
}

async function handleDocumentCreate(body: Record<string, unknown>) {
  const name = body.name as string;
  const type = body.type as string;
  if (!name) throw new Error("name is required");
  if (!type) throw new Error("type is required (document, spreadsheet, or presentation)");

  const request: Record<string, unknown> = { name, type };
  if (body.format) request.format = body.format;
  if (body.content) request.content = body.content;
  if (body.templateId) request.templateId = body.templateId;
  if (body.aiGenerate) request.aiGenerate = body.aiGenerate;
  return invokeIpcHandler("libreoffice:create", request);
}

async function handleDocumentAiGenerate(body: Record<string, unknown>) {
  const name = body.name as string;
  const type = (body.type as string) || "document";
  const prompt = body.prompt as string;
  if (!name) throw new Error("name is required");
  if (!prompt) throw new Error("prompt is required");

  const options: Record<string, unknown> = { prompt };
  if (body.provider) options.provider = body.provider;
  if (body.model) options.model = body.model;
  if (body.tone) options.tone = body.tone;
  if (body.length) options.length = body.length;
  if (body.language) options.language = body.language;
  if (body.style) options.style = body.style;
  options.routingMode = (body.routingMode as string) || "smart";

  return invokeIpcHandler("libreoffice:create", {
    name,
    type,
    aiGenerate: options,
  });
}

async function handleDocumentReadContent(body: Record<string, unknown>) {
  const id = body.id as number;
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("libreoffice:read-content", id);
}

async function handleDocumentUpdateContent(body: Record<string, unknown>) {
  const id = body.id as number;
  if (!id) throw new Error("id is required");
  const payload: Record<string, unknown> = {};
  if (body.text !== undefined) payload.text = body.text;
  if (body.rows !== undefined) payload.rows = body.rows;
  if (body.slides !== undefined) payload.slides = body.slides;
  return invokeIpcHandler("libreoffice:update-content", id, payload);
}

async function handleDocumentExport(body: Record<string, unknown>) {
  const documentId = body.documentId as number ?? body.id as number;
  const format = body.format as string;
  if (!documentId) throw new Error("documentId is required");
  if (!format) throw new Error("format is required (pdf, docx, xlsx, csv, txt, etc.)");

  const request: Record<string, unknown> = { documentId, format };
  if (body.options) request.options = body.options;
  return invokeIpcHandler("libreoffice:export", request);
}

async function handleDocumentDelete(body: Record<string, unknown>) {
  const id = body.id as number;
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("libreoffice:delete", id);
}

async function handleDocumentAiAssist(body: Record<string, unknown>) {
  const docId = body.docId as number;
  const command = body.command as string;
  const selection = body.selection as string;
  if (!docId) throw new Error("docId is required");
  if (!command) throw new Error("command is required (improve, grammar, summarize, continue, tone, explain, custom)");
  if (!selection) throw new Error("selection (the text to process) is required");

  const requestId = `api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // For API usage we need to collect streamed chunks into a single result.
  // We call the IPC handler which fires streaming events, so we intercept them.
  const chunks: string[] = [];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ requestId, result: chunks.join(""), timedOut: true });
    }, 120_000);

    function cleanup() {
      clearTimeout(timeout);
      ipcMain.removeAllListeners("libreoffice:ai-assist-chunk");
    }

    // Listen for streamed chunks from the handler
    const originalSend = ipcMain.emit.bind(ipcMain);
    // We hook into the safeSend mechanism by patching the fake event sender
    const fakeEvent = {
      sender: {
        isDestroyed: () => false,
        send: (_channel: string, data: { requestId: string; text: string; done: boolean; error?: string }) => {
          if (data.requestId !== requestId) return;
          if (data.text) chunks.push(data.text);
          if (data.done) {
            cleanup();
            if (data.error) reject(new Error(data.error));
            else resolve({ requestId, result: chunks.join("") });
          }
        },
      },
    } as unknown as Electron.IpcMainInvokeEvent;

    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Function> })._invokeHandlers;
    const handler = handlers?.get("libreoffice:ai-assist");
    if (!handler) {
      cleanup();
      reject(new Error("IPC handler not registered: libreoffice:ai-assist"));
      return;
    }

    const params: Record<string, unknown> = { docId, command, selection };
    if (body.context) params.context = body.context;
    if (body.toneValue) params.toneValue = body.toneValue;
    if (body.customPrompt) params.customPrompt = body.customPrompt;
    if (body.provider) params.provider = body.provider;
    if (body.model) params.model = body.model;

    handler(fakeEvent, requestId, params).catch((err: Error) => {
      cleanup();
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// n8n Workflow Automation Handlers
// ---------------------------------------------------------------------------

async function handleN8nStart(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:start");
}

async function handleN8nStop(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:stop");
}

async function handleN8nStatus(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:status");
}

async function handleN8nSetApiKey(body: Record<string, unknown>) {
  const apiKey = body.apiKey as string;
  if (!apiKey) throw new Error("apiKey is required");
  return invokeIpcHandler("n8n:set-api-key", apiKey);
}

async function handleN8nDbConfigure(body: Record<string, unknown>) {
  const config = body.config as Record<string, unknown>;
  if (!config) throw new Error("config object is required");
  return invokeIpcHandler("n8n:db:configure", config);
}

async function handleN8nDbGetConfig(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:db:get-config");
}

// -- Workflow CRUD --

async function handleN8nWorkflowCreate(body: Record<string, unknown>) {
  const workflow = body.workflow as Record<string, unknown>;
  if (!workflow) throw new Error("workflow object is required");
  return invokeIpcHandler("n8n:workflow:create", workflow);
}

async function handleN8nWorkflowUpdate(body: Record<string, unknown>) {
  const id = body.id as string;
  const workflow = body.workflow as Record<string, unknown>;
  if (!id) throw new Error("id is required");
  if (!workflow) throw new Error("workflow object is required");
  return invokeIpcHandler("n8n:workflow:update", id, workflow);
}

async function handleN8nWorkflowGet(body: Record<string, unknown>) {
  const id = body.id as string;
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("n8n:workflow:get", id);
}

async function handleN8nWorkflowList(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:workflow:list");
}

async function handleN8nWorkflowDelete(body: Record<string, unknown>) {
  const id = body.id as string;
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("n8n:workflow:delete", id);
}

async function handleN8nWorkflowActivate(body: Record<string, unknown>) {
  const id = body.id as string;
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("n8n:workflow:activate", id);
}

async function handleN8nWorkflowDeactivate(body: Record<string, unknown>) {
  const id = body.id as string;
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("n8n:workflow:deactivate", id);
}

async function handleN8nWorkflowExecute(body: Record<string, unknown>) {
  const id = body.id as string;
  if (!id) throw new Error("id is required");
  const data = body.data as Record<string, unknown> | undefined;
  return invokeIpcHandler("n8n:workflow:execute", id, data);
}

// -- AI Workflow Generation --

async function handleN8nWorkflowGenerate(body: Record<string, unknown>) {
  const prompt = body.prompt as string;
  if (!prompt) throw new Error("prompt is required");
  const request: Record<string, unknown> = { prompt };
  if (body.model) request.model = body.model;
  if (body.context) request.context = body.context;
  if (body.constraints) request.constraints = body.constraints;
  return invokeIpcHandler("n8n:workflow:generate", request);
}

async function handleN8nMetaBuilderCreate(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:meta-builder:create");
}

async function handleN8nSetupOllama(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:setup-ollama");
}

// -- Connections (multi-instance) --

async function handleN8nAddConnection(body: Record<string, unknown>) {
  const name = body.name as string;
  const baseUrl = body.baseUrl as string;
  if (!name) throw new Error("name is required");
  if (!baseUrl) throw new Error("baseUrl is required");
  const args: Record<string, unknown> = { name, baseUrl };
  if (body.apiKey) args.apiKey = body.apiKey;
  return invokeIpcHandler("n8n:add-connection", args);
}

async function handleN8nTestConnection(body: Record<string, unknown>) {
  const connectionId = body.connectionId as string;
  if (!connectionId) throw new Error("connectionId is required");
  return invokeIpcHandler("n8n:test-connection", connectionId);
}

async function handleN8nListConnections(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:list-connections");
}

async function handleN8nRemoveConnection(body: Record<string, unknown>) {
  const connectionId = body.connectionId as string;
  if (!connectionId) throw new Error("connectionId is required");
  return invokeIpcHandler("n8n:remove-connection", connectionId);
}

// -- Connection-scoped workflow ops --

async function handleN8nConnListWorkflows(body: Record<string, unknown>) {
  const connectionId = body.connectionId as string;
  if (!connectionId) throw new Error("connectionId is required");
  return invokeIpcHandler("n8n:list-workflows", connectionId);
}

async function handleN8nConnGetWorkflow(body: Record<string, unknown>) {
  const connectionId = body.connectionId as string;
  const workflowId = body.workflowId as string;
  if (!connectionId) throw new Error("connectionId is required");
  if (!workflowId) throw new Error("workflowId is required");
  return invokeIpcHandler("n8n:get-workflow", { connectionId, workflowId });
}

async function handleN8nConnCreateWorkflow(body: Record<string, unknown>) {
  const connectionId = body.connectionId as string;
  const workflow = body.workflow as Record<string, unknown>;
  if (!connectionId) throw new Error("connectionId is required");
  if (!workflow) throw new Error("workflow object is required");
  return invokeIpcHandler("n8n:create-workflow", { connectionId, workflow });
}

async function handleN8nConnExecuteWorkflow(body: Record<string, unknown>) {
  const connectionId = body.connectionId as string;
  const workflowId = body.workflowId as string;
  if (!connectionId) throw new Error("connectionId is required");
  if (!workflowId) throw new Error("workflowId is required");
  const args: Record<string, unknown> = { connectionId, workflowId };
  if (body.data) args.data = body.data;
  return invokeIpcHandler("n8n:execute-workflow", args);
}

// -- Webhooks --

async function handleN8nCreateWebhook(body: Record<string, unknown>) {
  const webhookPath = body.path as string;
  if (!webhookPath) throw new Error("path is required");
  const args: Record<string, unknown> = {
    path: webhookPath,
    handler: body.handler || { type: "event", target: "api" },
  };
  if (body.method) args.method = body.method;
  if (body.description) args.description = body.description;
  if (body.authentication) args.authentication = body.authentication;
  return invokeIpcHandler("n8n:create-webhook", args);
}

async function handleN8nListWebhooks(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:list-webhooks");
}

async function handleN8nDeleteWebhook(body: Record<string, unknown>) {
  const webhookId = body.webhookId as string;
  if (!webhookId) throw new Error("webhookId is required");
  return invokeIpcHandler("n8n:delete-webhook", webhookId);
}

async function handleN8nToggleWebhook(body: Record<string, unknown>) {
  const webhookId = body.webhookId as string;
  const enabled = body.enabled as boolean;
  if (!webhookId) throw new Error("webhookId is required");
  if (enabled === undefined) throw new Error("enabled (boolean) is required");
  return invokeIpcHandler("n8n:toggle-webhook", { webhookId, enabled });
}

async function handleN8nWebhookHistory(body: Record<string, unknown>) {
  const args: Record<string, unknown> = {};
  if (body.endpointId) args.endpointId = body.endpointId;
  if (body.limit) args.limit = body.limit;
  return invokeIpcHandler("n8n:get-webhook-history", Object.keys(args).length > 0 ? args : undefined);
}

// -- Templates --

async function handleN8nListTemplates(body: Record<string, unknown>) {
  const category = body.category as string | undefined;
  return invokeIpcHandler("n8n:list-templates", category);
}

async function handleN8nDeployTemplate(body: Record<string, unknown>) {
  const templateId = body.templateId as string;
  const connectionId = body.connectionId as string;
  if (!templateId) throw new Error("templateId is required");
  if (!connectionId) throw new Error("connectionId is required");
  const args: Record<string, unknown> = {
    templateId,
    connectionId,
    variables: body.variables || {},
  };
  if (body.name) args.name = body.name;
  return invokeIpcHandler("n8n:deploy-template", args);
}

// -- Mappings --

async function handleN8nCreateMapping(body: Record<string, unknown>) {
  const name = body.name as string;
  const localType = body.localType as string;
  const localId = body.localId as string;
  const n8nWorkflowId = body.n8nWorkflowId as string;
  const n8nConnectionId = body.n8nConnectionId as string;
  if (!name) throw new Error("name is required");
  if (!localType) throw new Error("localType is required (workflow, task, agent, pipeline)");
  if (!localId) throw new Error("localId is required");
  if (!n8nWorkflowId) throw new Error("n8nWorkflowId is required");
  if (!n8nConnectionId) throw new Error("n8nConnectionId is required");
  const args: Record<string, unknown> = { name, localType, localId, n8nWorkflowId, n8nConnectionId };
  if (body.description) args.description = body.description;
  if (body.syncMode) args.syncMode = body.syncMode;
  if (body.fieldMappings) args.fieldMappings = body.fieldMappings;
  if (body.triggerConfig) args.triggerConfig = body.triggerConfig;
  return invokeIpcHandler("n8n:create-mapping", args);
}

async function handleN8nListMappings(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:list-mappings");
}

async function handleN8nSyncMapping(body: Record<string, unknown>) {
  const mappingId = body.mappingId as string;
  if (!mappingId) throw new Error("mappingId is required");
  return invokeIpcHandler("n8n:sync-mapping", mappingId);
}

// -- Server control --

async function handleN8nStartServer(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:start-server");
}

async function handleN8nStopServer(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:stop-server");
}

async function handleN8nGetServerStatus(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:get-server-status");
}

// -- Config --

async function handleN8nGetConfig(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:get-config");
}

async function handleN8nUpdateConfig(body: Record<string, unknown>) {
  const updates = body.updates as Record<string, unknown>;
  if (!updates) throw new Error("updates object is required");
  return invokeIpcHandler("n8n:update-config", updates);
}

// -- Agent Triggers --

async function handleTriggerCreate(body: Record<string, unknown>) {
  const agentId = body.agentId as number;
  const name = body.name as string;
  const type = body.type as string;
  if (!agentId) throw new Error("agentId is required");
  if (!name) throw new Error("name is required");
  if (!type) throw new Error("type is required (gmail, slack, google-sheets, webhook, schedule, calendar, discord, telegram, manual)");
  const request: Record<string, unknown> = { agentId, name, type };
  if (body.description) request.description = body.description;
  if (body.config) request.config = body.config;
  return invokeIpcHandler("agent:trigger:create", request);
}

async function handleTriggerList(body: Record<string, unknown>) {
  const agentId = body.agentId as number;
  if (!agentId) throw new Error("agentId is required");
  return invokeIpcHandler("agent:trigger:list", agentId);
}

async function handleTriggerActivate(body: Record<string, unknown>) {
  const triggerId = body.triggerId as string;
  if (!triggerId) throw new Error("triggerId is required");
  return invokeIpcHandler("agent:trigger:activate", triggerId);
}

async function handleTriggerPause(body: Record<string, unknown>) {
  const triggerId = body.triggerId as string;
  if (!triggerId) throw new Error("triggerId is required");
  return invokeIpcHandler("agent:trigger:pause", triggerId);
}

async function handleTriggerDelete(body: Record<string, unknown>) {
  const triggerId = body.triggerId as string;
  if (!triggerId) throw new Error("triggerId is required");
  return invokeIpcHandler("agent:trigger:delete", triggerId);
}

// -- Tool Catalog --

async function handleToolCatalogList(_body: Record<string, unknown>) {
  return invokeIpcHandler("agent:tool-catalog:list");
}

async function handleToolCatalogByCategory(body: Record<string, unknown>) {
  const category = body.category as string;
  if (!category) throw new Error("category is required");
  return invokeIpcHandler("agent:tool-catalog:by-category", category);
}

async function handleToolCatalogSearch(body: Record<string, unknown>) {
  const query = body.query as string;
  if (!query) throw new Error("query is required");
  return invokeIpcHandler("agent:tool-catalog:search", query);
}

// -- Agent Stack --

async function handleAgentStackBuild(body: Record<string, unknown>) {
  const agentId = body.agentId as number;
  if (!agentId) throw new Error("agentId is required");
  const request: Record<string, unknown> = { agentId };
  if (body.triggerIds) request.triggerIds = body.triggerIds;
  if (body.toolIds) request.toolIds = body.toolIds;
  if (body.syncToN8n !== undefined) request.syncToN8n = body.syncToN8n;
  return invokeIpcHandler("agent:stack:build", request);
}

async function handleAgentStackGet(body: Record<string, unknown>) {
  const agentId = body.agentId as number;
  if (!agentId) throw new Error("agentId is required");
  return invokeIpcHandler("agent:stack:get", agentId);
}

async function handleAgentStackSyncN8n(body: Record<string, unknown>) {
  const agentId = body.agentId as number;
  if (!agentId) throw new Error("agentId is required");
  return invokeIpcHandler("agent:stack:sync-n8n", agentId);
}

// -- Agent Communication --

async function handleAgentSendMessage(body: Record<string, unknown>) {
  const fromAgentId = body.fromAgentId as number;
  const toAgentId = body.toAgentId as number | string;
  const type = body.type as string;
  if (!fromAgentId) throw new Error("fromAgentId is required");
  if (!toAgentId) throw new Error("toAgentId is required (agent ID or 'broadcast')");
  if (!type) throw new Error("type is required");
  const message: Record<string, unknown> = { fromAgentId, toAgentId, type };
  if (body.payload) message.payload = body.payload;
  return invokeIpcHandler("n8n:agent:send-message", message);
}

async function handleAgentGetMessages(body: Record<string, unknown>) {
  const agentId = body.agentId as number;
  if (!agentId) throw new Error("agentId is required");
  return invokeIpcHandler("n8n:agent:get-messages", agentId);
}

async function handleAgentCreateCollaboration(body: Record<string, unknown>) {
  const name = body.name as string;
  const agentIds = body.agentIds as number[];
  if (!name) throw new Error("name is required");
  if (!agentIds || !Array.isArray(agentIds)) throw new Error("agentIds (number array) is required");
  return invokeIpcHandler("n8n:agent:create-collaboration", name, agentIds);
}

async function handleAgentListCollaborations(_body: Record<string, unknown>) {
  return invokeIpcHandler("n8n:agent:list-collaborations");
}

async function handleAgentGetCollaboration(body: Record<string, unknown>) {
  const id = body.id as string;
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("n8n:agent:get-collaboration", id);
}

async function handleAgentCreateCollabWorkflow(body: Record<string, unknown>) {
  const agentIds = body.agentIds as number[];
  if (!agentIds || !Array.isArray(agentIds)) throw new Error("agentIds (number array) is required");
  return invokeIpcHandler("n8n:agent:create-collab-workflow", agentIds);
}

// -- Workflow Marketplace --

async function handleWorkflowPublish(body: Record<string, unknown>) {
  const sourceId = body.sourceId || body.workflowId;
  if (!sourceId) throw new Error("sourceId (workflowId) is required");
  const payload: Record<string, unknown> = { sourceId };
  if (body.name) payload.name = body.name;
  if (body.description) payload.description = body.description;
  if (body.category) payload.category = body.category;
  if (body.price !== undefined) payload.price = body.price;
  if (body.tags) payload.tags = body.tags;
  return invokeIpcHandler("workflow:publish-to-marketplace", payload);
}

async function handleWorkflowInstall(body: Record<string, unknown>) {
  const marketplaceId = body.marketplaceId as string;
  if (!marketplaceId) throw new Error("marketplaceId is required");
  const payload: Record<string, unknown> = { marketplaceId };
  if (body.connectionId) payload.connectionId = body.connectionId;
  return invokeIpcHandler("workflow:install-from-marketplace", payload);
}

async function handleWorkflowUnpublish(body: Record<string, unknown>) {
  const workflowId = body.workflowId as string;
  if (!workflowId) throw new Error("workflowId is required");
  return invokeIpcHandler("workflow:unpublish", workflowId);
}

async function handleWorkflowListPublished(_body: Record<string, unknown>) {
  return invokeIpcHandler("workflow:list-published");
}

// ---------------------------------------------------------------------------
// Skill handlers
// ---------------------------------------------------------------------------

async function handleSkillList(body: Record<string, unknown>) {
  const params: Record<string, unknown> = {};
  if (body.category) params.category = body.category;
  if (body.type) params.type = body.type;
  if (body.query) params.query = body.query;
  if (body.enabled !== undefined) params.enabled = body.enabled;
  if (body.limit) params.limit = body.limit;
  if (body.offset) params.offset = body.offset;
  return invokeIpcHandler("skill:list", Object.keys(params).length > 0 ? params : undefined);
}

async function handleSkillGet(body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("skill:get", id);
}

async function handleSkillCreate(body: Record<string, unknown>) {
  const name = body.name as string;
  if (!name) throw new Error("name is required");
  const params: Record<string, unknown> = { name };
  if (body.description) params.description = body.description;
  if (body.category) params.category = body.category;
  if (body.type) params.type = body.type;
  if (body.implementationType) params.implementationType = body.implementationType;
  if (body.implementationCode) params.implementationCode = body.implementationCode;
  if (body.triggerPatterns) params.triggerPatterns = body.triggerPatterns;
  if (body.inputSchema) params.inputSchema = body.inputSchema;
  if (body.outputSchema) params.outputSchema = body.outputSchema;
  if (body.examples) params.examples = body.examples;
  if (body.tags) params.tags = body.tags;
  return invokeIpcHandler("skill:create", params);
}

async function handleSkillUpdate(body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!id) throw new Error("id is required");
  const params: Record<string, unknown> = { id };
  if (body.name !== undefined) params.name = body.name;
  if (body.description !== undefined) params.description = body.description;
  if (body.category !== undefined) params.category = body.category;
  if (body.type !== undefined) params.type = body.type;
  if (body.implementationType !== undefined) params.implementationType = body.implementationType;
  if (body.implementationCode !== undefined) params.implementationCode = body.implementationCode;
  if (body.triggerPatterns !== undefined) params.triggerPatterns = body.triggerPatterns;
  if (body.inputSchema !== undefined) params.inputSchema = body.inputSchema;
  if (body.outputSchema !== undefined) params.outputSchema = body.outputSchema;
  if (body.examples !== undefined) params.examples = body.examples;
  if (body.tags !== undefined) params.tags = body.tags;
  if (body.enabled !== undefined) params.enabled = body.enabled;
  return invokeIpcHandler("skill:update", params);
}

async function handleSkillDelete(body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("skill:delete", id);
}

async function handleSkillSearch(body: Record<string, unknown>) {
  const params: Record<string, unknown> = {};
  if (body.query) params.query = body.query;
  if (body.category) params.category = body.category;
  if (body.type) params.type = body.type;
  return invokeIpcHandler("skill:search", params);
}

async function handleSkillMatch(body: Record<string, unknown>) {
  const text = body.text as string;
  if (!text) throw new Error("text is required");
  const agentId = body.agentId ? Number(body.agentId) : undefined;
  return invokeIpcHandler("skill:match", text, agentId);
}

async function handleSkillExecute(body: Record<string, unknown>) {
  const skillId = Number(body.skillId);
  if (!skillId) throw new Error("skillId is required");
  const params: Record<string, unknown> = { skillId };
  if (body.input) params.input = body.input;
  if (body.context) params.context = body.context;
  if (body.agentId) params.agentId = Number(body.agentId);
  return invokeIpcHandler("skill:execute", params);
}

async function handleSkillGenerate(body: Record<string, unknown>) {
  const description = body.description as string;
  if (!description) throw new Error("description is required");
  const request: Record<string, unknown> = { description };
  if (body.category) request.category = body.category;
  if (body.implementationType) request.implementationType = body.implementationType;
  return invokeIpcHandler("skill:generate", request);
}

async function handleSkillAutoGenerate(body: Record<string, unknown>) {
  const agentId = Number(body.agentId);
  const conversationHistory = body.conversationHistory as Array<{ role: string; content: string }>;
  if (!agentId) throw new Error("agentId is required");
  if (!conversationHistory?.length) throw new Error("conversationHistory is required");
  return invokeIpcHandler("skill:auto-generate", { agentId, conversationHistory });
}

async function handleSkillAttachToAgent(body: Record<string, unknown>) {
  const skillId = Number(body.skillId);
  const agentId = Number(body.agentId);
  if (!skillId) throw new Error("skillId is required");
  if (!agentId) throw new Error("agentId is required");
  return invokeIpcHandler("skill:attach-to-agent", { skillId, agentId });
}

async function handleSkillDetachFromAgent(body: Record<string, unknown>) {
  const skillId = Number(body.skillId);
  const agentId = Number(body.agentId);
  if (!skillId) throw new Error("skillId is required");
  if (!agentId) throw new Error("agentId is required");
  return invokeIpcHandler("skill:detach-from-agent", { skillId, agentId });
}

async function handleSkillListForAgent(body: Record<string, unknown>) {
  const agentId = Number(body.agentId);
  if (!agentId) throw new Error("agentId is required");
  return invokeIpcHandler("skill:list-for-agent", agentId);
}

async function handleSkillExport(body: Record<string, unknown>) {
  const skillId = Number(body.skillId);
  if (!skillId) throw new Error("skillId is required");
  return invokeIpcHandler("skill:export", skillId);
}

async function handleSkillImport(body: Record<string, unknown>) {
  const json = body.json as string;
  if (!json) throw new Error("json is required (stringified skill JSON)");
  return invokeIpcHandler("skill:import", json);
}

async function handleSkillExportMd(_body: Record<string, unknown>) {
  return invokeIpcHandler("skill:export-md");
}

async function handleSkillBootstrap(_body: Record<string, unknown>) {
  return invokeIpcHandler("skill:bootstrap");
}

async function handleSkillLearn(body: Record<string, unknown>) {
  const message = body.message as string;
  if (!message) throw new Error("message is required");
  const agentId = body.agentId ? Number(body.agentId) : undefined;
  return invokeIpcHandler("skill:learn", { message, agentId });
}

// ---------------------------------------------------------------------------
// Orchestrator handlers
// ---------------------------------------------------------------------------

async function handleOrchestratorStatus(_body: Record<string, unknown>) {
  return invokeIpcHandler("orchestrator:status");
}

async function handleOrchestratorSubmitTask(body: Record<string, unknown>) {
  const prompt = body.prompt as string;
  if (!prompt) throw new Error("prompt is required");
  return invokeIpcHandler("orchestrator:submit-task", body);
}

async function handleOrchestratorGet(body: Record<string, unknown>) {
  const taskId = body.taskId as string;
  if (!taskId) throw new Error("taskId is required");
  return invokeIpcHandler("orchestrator:get", taskId);
}

async function handleOrchestratorList(_body: Record<string, unknown>) {
  return invokeIpcHandler("orchestrator:list");
}

async function handleOrchestratorCancel(body: Record<string, unknown>) {
  const taskId = body.taskId as string;
  if (!taskId) throw new Error("taskId is required");
  return invokeIpcHandler("orchestrator:cancel", taskId);
}

async function handleOrchestratorPause(body: Record<string, unknown>) {
  const taskId = body.taskId as string;
  if (!taskId) throw new Error("taskId is required");
  return invokeIpcHandler("orchestrator:pause", taskId);
}

async function handleOrchestratorResume(body: Record<string, unknown>) {
  const taskId = body.taskId as string;
  if (!taskId) throw new Error("taskId is required");
  return invokeIpcHandler("orchestrator:resume", taskId);
}

async function handleOrchestratorDashboard(_body: Record<string, unknown>) {
  return invokeIpcHandler("orchestrator:dashboard");
}

async function handleOrchestratorTemplates(_body: Record<string, unknown>) {
  return invokeIpcHandler("orchestrator:templates");
}

// ---------------------------------------------------------------------------
// Voice Assistant handlers
// ---------------------------------------------------------------------------

async function handleVoiceGetConfig(_body: Record<string, unknown>) {
  return invokeIpcHandler("voice:get-config");
}

async function handleVoiceUpdateConfig(body: Record<string, unknown>) {
  return invokeIpcHandler("voice:update-config", body);
}

async function handleVoiceGetState(_body: Record<string, unknown>) {
  return invokeIpcHandler("voice:get-state");
}

async function handleVoiceGetCapabilities(_body: Record<string, unknown>) {
  return invokeIpcHandler("voice:get-capabilities");
}

async function handleVoiceSpeak(body: Record<string, unknown>) {
  const text = body.text as string;
  if (!text) throw new Error("text is required");
  return invokeIpcHandler("voice:speak", body);
}

async function handleVoiceTranscribeFile(body: Record<string, unknown>) {
  const filePath = body.filePath as string;
  if (!filePath) throw new Error("filePath is required");
  return invokeIpcHandler("voice:transcribe-file", body);
}

async function handleVoiceGetInstalledModels(_body: Record<string, unknown>) {
  return invokeIpcHandler("voice:get-installed-models");
}

// ---------------------------------------------------------------------------
// Analytics & Reporting handlers
// ---------------------------------------------------------------------------

async function handleAnalyticsGlobal(_body: Record<string, unknown>) {
  return invokeIpcHandler("analytics:global");
}

async function handleAnalyticsGenerateReport(body: Record<string, unknown>) {
  return invokeIpcHandler("analytics:generate-report", body);
}

async function handleAnalyticsListReports(_body: Record<string, unknown>) {
  return invokeIpcHandler("analytics:list-reports");
}

async function handleAnalyticsGetReport(body: Record<string, unknown>) {
  const reportId = body.reportId as string;
  if (!reportId) throw new Error("reportId is required");
  return invokeIpcHandler("analytics:get-report", reportId);
}

async function handleAnalyticsDeleteReport(body: Record<string, unknown>) {
  const reportId = body.reportId as string;
  if (!reportId) throw new Error("reportId is required");
  return invokeIpcHandler("analytics:delete-report", reportId);
}

async function handleAnalyticsGetDashboard(body: Record<string, unknown>) {
  const dashboardId = body.dashboardId as string;
  return invokeIpcHandler("analytics:get-dashboard", dashboardId);
}

async function handleAnalyticsCreateDashboard(body: Record<string, unknown>) {
  return invokeIpcHandler("analytics:create-dashboard", body);
}

// ---------------------------------------------------------------------------
// Version Control handlers
// ---------------------------------------------------------------------------

async function handleVersionCommit(body: Record<string, unknown>) {
  const appId = Number(body.appId);
  if (!appId) throw new Error("appId is required");
  return invokeIpcHandler("version:commit", body);
}

async function handleVersionList(body: Record<string, unknown>) {
  const appId = Number(body.appId);
  if (!appId) throw new Error("appId is required");
  return invokeIpcHandler("version:list", body);
}

async function handleVersionGet(body: Record<string, unknown>) {
  const versionId = body.versionId as string;
  if (!versionId) throw new Error("versionId is required");
  return invokeIpcHandler("version:get", body);
}

async function handleVersionDiff(body: Record<string, unknown>) {
  return invokeIpcHandler("version:diff", body);
}

async function handleVersionRollback(body: Record<string, unknown>) {
  const appId = Number(body.appId);
  const versionId = body.versionId as string;
  if (!appId || !versionId) throw new Error("appId and versionId are required");
  return invokeIpcHandler("version:rollback", body);
}

async function handleVersionCreateBranch(body: Record<string, unknown>) {
  const appId = Number(body.appId);
  const name = body.name as string;
  if (!appId || !name) throw new Error("appId and name are required");
  return invokeIpcHandler("version:create-branch", body);
}

async function handleVersionListBranches(body: Record<string, unknown>) {
  const appId = Number(body.appId);
  if (!appId) throw new Error("appId is required");
  return invokeIpcHandler("version:list-branches", body);
}

async function handleVersionMerge(body: Record<string, unknown>) {
  return invokeIpcHandler("version:merge", body);
}

async function handleVersionTimeline(body: Record<string, unknown>) {
  const appId = Number(body.appId);
  if (!appId) throw new Error("appId is required");
  return invokeIpcHandler("version:timeline", body);
}

// ---------------------------------------------------------------------------
// Calendar handlers
// ---------------------------------------------------------------------------

async function handleCalendarListSources(_body: Record<string, unknown>) {
  return invokeIpcHandler("calendar:list-sources");
}

async function handleCalendarSyncAll(_body: Record<string, unknown>) {
  return invokeIpcHandler("calendar:sync-all");
}

async function handleCalendarGetEvent(body: Record<string, unknown>) {
  const eventId = body.eventId as string;
  if (!eventId) throw new Error("eventId is required");
  return invokeIpcHandler("calendar:get-event", eventId);
}

async function handleCalendarExportIcs(body: Record<string, unknown>) {
  return invokeIpcHandler("calendar:export-ics", body);
}

// ---------------------------------------------------------------------------
// Vector Store handlers
// ---------------------------------------------------------------------------

async function handleVectorListCollections(_body: Record<string, unknown>) {
  return invokeIpcHandler("vector:list-collections");
}

async function handleVectorGetCollection(body: Record<string, unknown>) {
  const name = body.name as string;
  if (!name) throw new Error("name is required");
  return invokeIpcHandler("vector:get-collection", name);
}

async function handleVectorDeleteCollection(body: Record<string, unknown>) {
  const name = body.name as string;
  if (!name) throw new Error("name is required");
  return invokeIpcHandler("vector:delete-collection", name);
}

async function handleVectorGetStats(_body: Record<string, unknown>) {
  return invokeIpcHandler("vector:get-stats");
}

// ---------------------------------------------------------------------------
// Image Studio handlers
// ---------------------------------------------------------------------------

async function handleImageStudioGenerate(body: Record<string, unknown>) {
  const prompt = body.prompt as string;
  if (!prompt) throw new Error("prompt is required");
  return invokeIpcHandler("image-studio:generate", body);
}

async function handleImageStudioEdit(body: Record<string, unknown>) {
  return invokeIpcHandler("image-studio:edit", body);
}

async function handleImageStudioList(_body: Record<string, unknown>) {
  return invokeIpcHandler("image-studio:list");
}

async function handleImageStudioGet(body: Record<string, unknown>) {
  const imageId = body.imageId as string;
  if (!imageId) throw new Error("imageId is required");
  return invokeIpcHandler("image-studio:get", imageId);
}

async function handleImageStudioDelete(body: Record<string, unknown>) {
  const imageId = body.imageId as string;
  if (!imageId) throw new Error("imageId is required");
  return invokeIpcHandler("image-studio:delete", imageId);
}

async function handleImageStudioAvailableProviders(_body: Record<string, unknown>) {
  return invokeIpcHandler("image-studio:available-providers");
}

async function handleImageStudioEnhancePrompt(body: Record<string, unknown>) {
  const prompt = body.prompt as string;
  if (!prompt) throw new Error("prompt is required");
  return invokeIpcHandler("image-studio:enhance-prompt", prompt);
}

// ---------------------------------------------------------------------------
// Dataset Studio handlers
// ---------------------------------------------------------------------------

async function handleDatasetCreate(body: Record<string, unknown>) {
  return invokeIpcHandler("dataset-studio:create-dataset", body);
}

async function handleDatasetList(_body: Record<string, unknown>) {
  return invokeIpcHandler("dataset-studio:list-datasets");
}

async function handleDatasetGet(body: Record<string, unknown>) {
  const datasetId = body.datasetId as string;
  if (!datasetId) throw new Error("datasetId is required");
  return invokeIpcHandler("dataset-studio:get-dataset", datasetId);
}

async function handleDatasetUpdate(body: Record<string, unknown>) {
  return invokeIpcHandler("dataset-studio:update-dataset", body);
}

async function handleDatasetDelete(body: Record<string, unknown>) {
  const datasetId = body.datasetId as string;
  if (!datasetId) throw new Error("datasetId is required");
  return invokeIpcHandler("dataset-studio:delete-dataset", datasetId);
}

async function handleDatasetListItems(body: Record<string, unknown>) {
  const datasetId = body.datasetId as string;
  if (!datasetId) throw new Error("datasetId is required");
  return invokeIpcHandler("dataset-studio:list-items", body);
}

async function handleDatasetGetItem(body: Record<string, unknown>) {
  const itemId = body.itemId as string;
  if (!itemId) throw new Error("itemId is required");
  return invokeIpcHandler("dataset-studio:get-item", itemId);
}

async function handleDatasetExport(body: Record<string, unknown>) {
  const datasetId = body.datasetId as string;
  if (!datasetId) throw new Error("datasetId is required");
  return invokeIpcHandler("dataset-studio:export-dataset", body);
}

// ---------------------------------------------------------------------------
// GitHub handlers
// ---------------------------------------------------------------------------

async function handleGithubListRepos(_body: Record<string, unknown>) {
  return invokeIpcHandler("github:list-repos");
}

async function handleGithubCreateRepo(body: Record<string, unknown>) {
  const name = body.name as string;
  if (!name) throw new Error("name is required");
  return invokeIpcHandler("github:create-repo", body);
}

async function handleGithubPush(body: Record<string, unknown>) {
  return invokeIpcHandler("github:push", body);
}

// ---------------------------------------------------------------------------
// Library handlers (personal file bookshelf with decentralized storage)
// ---------------------------------------------------------------------------

async function handleLibraryImportBuffer(body: Record<string, unknown>) {
  const name = body.name as string;
  const base64 = body.base64 as string;
  if (!name || !base64) throw new Error("name and base64 are required");
  const mimeType = body.mimeType as string | undefined;
  return invokeIpcHandler("library:import-buffer", { name, base64, mimeType });
}

async function handleLibraryList(body: Record<string, unknown>) {
  const filters: Record<string, unknown> = {};
  if (body.storageTier) filters.storageTier = body.storageTier;
  if (body.mimeType) filters.mimeType = body.mimeType;
  if (body.search) filters.search = body.search;
  if (body.category) filters.category = body.category;
  return invokeIpcHandler("library:list", Object.keys(filters).length > 0 ? filters : undefined);
}

async function handleLibraryGet(body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("library:get", id);
}

async function handleLibraryGetContent(body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("library:get-content", id);
}

async function handleLibraryUpdate(body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("library:update", body);
}

async function handleLibraryDelete(body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("library:delete", id);
}

async function handleLibraryStoreToIpfs(body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("library:store-to-ipfs", id);
}

async function handleLibraryPinToRemote(body: Record<string, unknown>) {
  const id = Number(body.id);
  if (!id) throw new Error("id is required");
  return invokeIpcHandler("library:pin-to-remote", id);
}

// ---------------------------------------------------------------------------
// Celestia Blob handlers (decentralized data availability layer)
// ---------------------------------------------------------------------------

async function handleCelestiaStatus(_body: Record<string, unknown>) {
  return invokeIpcHandler("celestia:status");
}

async function handleCelestiaConfigGet(_body: Record<string, unknown>) {
  return invokeIpcHandler("celestia:config:get");
}

async function handleCelestiaConfigUpdate(body: Record<string, unknown>) {
  return invokeIpcHandler("celestia:config:update", body);
}

async function handleCelestiaConfigReset(_body: Record<string, unknown>) {
  return invokeIpcHandler("celestia:config:reset");
}

async function handleCelestiaBlobSubmit(body: Record<string, unknown>) {
  const data = body.data as string;
  if (!data) throw new Error("data (base64) is required");
  return invokeIpcHandler("celestia:blob:submit", body);
}

async function handleCelestiaBlobSubmitJson(body: Record<string, unknown>) {
  const json = body.json;
  if (json === undefined) throw new Error("json is required");
  return invokeIpcHandler("celestia:blob:submit-json", body);
}

async function handleCelestiaBlobSubmitFile(body: Record<string, unknown>) {
  const filePath = body.filePath as string;
  if (!filePath) throw new Error("filePath is required");
  return invokeIpcHandler("celestia:blob:submit-file", body);
}

async function handleCelestiaBlobGet(body: Record<string, unknown>) {
  const contentHash = body.contentHash as string;
  if (!contentHash) throw new Error("contentHash is required");
  return invokeIpcHandler("celestia:blob:get", body);
}

async function handleCelestiaBlobGetAtHeight(body: Record<string, unknown>) {
  const height = Number(body.height);
  if (!height) throw new Error("height is required");
  return invokeIpcHandler("celestia:blob:get-at-height", body);
}

async function handleCelestiaBlobList(body: Record<string, unknown>) {
  return invokeIpcHandler("celestia:blob:list", Object.keys(body).length > 0 ? body : undefined);
}

async function handleCelestiaBlobStats(_body: Record<string, unknown>) {
  return invokeIpcHandler("celestia:blob:stats");
}

async function handleCelestiaBlobHash(body: Record<string, unknown>) {
  const data = body.data as string;
  if (!data) throw new Error("data (base64) is required");
  return invokeIpcHandler("celestia:blob:hash", { data });
}

async function handleCelestiaBlobVerify(body: Record<string, unknown>) {
  const contentHash = body.contentHash as string;
  if (!contentHash) throw new Error("contentHash is required");
  return invokeIpcHandler("celestia:blob:verify", { contentHash });
}

async function handleCelestiaNamespaceGenerate(body: Record<string, unknown>) {
  const namespaceId = body.namespaceId as string;
  if (!namespaceId) throw new Error("namespaceId is required");
  return invokeIpcHandler("celestia:namespace:generate", { namespaceId });
}

async function handleCelestiaWalletValidate(body: Record<string, unknown>) {
  const address = body.address as string;
  if (!address) throw new Error("address is required");
  return invokeIpcHandler("celestia:wallet:validate", { address });
}

// ---------------------------------------------------------------------------
// Tokenomics handlers
// ---------------------------------------------------------------------------

async function handleTokenomicsGetStats(_body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:get-stats");
}

async function handleTokenomicsGetStakes(body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:get-stakes", body.stakerId as string | undefined);
}

async function handleTokenomicsCreateStake(body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:create-stake", body.stakerId, body.stakeType, body.amount, body.currency);
}

async function handleTokenomicsUnstake(body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:unstake", body.stakeId);
}

async function handleTokenomicsGetEarnings(body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:get-earnings", body.userId, body.period);
}

async function handleTokenomicsGetReputation(body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:get-reputation", body.userId);
}

async function handleTokenomicsRecordMeter(body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:record-meter", body.consumerId, body.assetId, body.assetType, body.usage);
}

async function handleTokenomicsGetFeeSchedule(_body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:get-fee-schedule");
}

async function handleTokenomicsGetRewardRules(_body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:get-reward-rules");
}

async function handleTokenomicsCreateBilling(body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:create-billing-account", body.walletAddress, body.did);
}

async function handleTokenomicsGetBillingAccounts(body: Record<string, unknown>) {
  return invokeIpcHandler("tokenomics:get-billing-accounts", body.walletAddress);
}

// ---------------------------------------------------------------------------
// A2A Protocol handlers
// ---------------------------------------------------------------------------

async function handleA2ARegisterAgent(body: Record<string, unknown>) {
  return invokeIpcHandler("a2a:register-agent", body);
}

async function handleA2AGetMyAgents(_body: Record<string, unknown>) {
  return invokeIpcHandler("a2a:get-my-agents");
}

async function handleA2ASearchAgents(body: Record<string, unknown>) {
  return invokeIpcHandler("a2a:search-agents", body);
}

async function handleA2AGetAgent(body: Record<string, unknown>) {
  return invokeIpcHandler("a2a:get-agent", body.agentId);
}

async function handleA2ACreateTask(body: Record<string, unknown>) {
  return invokeIpcHandler("a2a:create-task", body.requesterId, body.executorId, body.capabilityId, body.input, body.options);
}

async function handleA2AAcceptTask(body: Record<string, unknown>) {
  return invokeIpcHandler("a2a:accept-task", body.taskId, body.agreedPrice);
}

async function handleA2AGetTasks(body: Record<string, unknown>) {
  return invokeIpcHandler("a2a:get-tasks", body.filters);
}

async function handleA2AGetNetworkStats(_body: Record<string, unknown>) {
  return invokeIpcHandler("a2a:get-network-stats");
}

async function handleA2ACompleteTask(body: Record<string, unknown>) {
  return invokeIpcHandler("a2a:complete-task", body.taskId, body.output, body.usage);
}

// ---------------------------------------------------------------------------
// Governance handlers
// ---------------------------------------------------------------------------

async function handleGovernanceGetStats(_body: Record<string, unknown>) {
  return invokeIpcHandler("governance:get-stats");
}

async function handleGovernanceCreateProposal(body: Record<string, unknown>) {
  return invokeIpcHandler("governance:create-proposal", body);
}

async function handleGovernanceGetProposal(body: Record<string, unknown>) {
  return invokeIpcHandler("governance:get-proposal", body.proposalId);
}

async function handleGovernanceListProposals(body: Record<string, unknown>) {
  return invokeIpcHandler("governance:list-proposals", body);
}

async function handleGovernanceCastVote(body: Record<string, unknown>) {
  return invokeIpcHandler("governance:cast-vote", body);
}

async function handleGovernanceGetVotingPower(body: Record<string, unknown>) {
  return invokeIpcHandler("governance:get-voting-power", body.userId);
}

async function handleGovernanceDelegate(body: Record<string, unknown>) {
  return invokeIpcHandler("governance:delegate", body);
}

async function handleGovernanceGetDelegations(body: Record<string, unknown>) {
  return invokeIpcHandler("governance:get-delegations", body.userId);
}

async function handleGovernanceGetTreasuryStats(_body: Record<string, unknown>) {
  return invokeIpcHandler("governance:get-treasury-stats");
}

async function handleGovernanceGetConfig(_body: Record<string, unknown>) {
  return invokeIpcHandler("governance:get-config");
}

async function handleGovernanceExecuteProposal(body: Record<string, unknown>) {
  return invokeIpcHandler("governance:execute-proposal", body.proposalId);
}

// ---------------------------------------------------------------------------
// NLP Pipeline handlers
// ---------------------------------------------------------------------------

async function handleNlpListEngines(_body: Record<string, unknown>) {
  return invokeIpcHandler("nlp:list-engines");
}

async function handleNlpListPipelines(_body: Record<string, unknown>) {
  return invokeIpcHandler("nlp:list-pipelines");
}

async function handleNlpProcessText(body: Record<string, unknown>) {
  return invokeIpcHandler("nlp:process-text", body);
}

async function handleNlpProcessDataset(body: Record<string, unknown>) {
  return invokeIpcHandler("nlp:process-dataset", body);
}

async function handleNlpAutoTagDataset(body: Record<string, unknown>) {
  return invokeIpcHandler("nlp:auto-tag-dataset", body);
}

async function handleNlpPrepareListing(body: Record<string, unknown>) {
  return invokeIpcHandler("nlp:prepare-marketplace-listing", body);
}

async function handleNlpPublishDataset(body: Record<string, unknown>) {
  return invokeIpcHandler("nlp:publish-dataset", body);
}

async function handleNlpRecommendModel(body: Record<string, unknown>) {
  const datasetId = body.datasetId as string;
  if (!datasetId) throw new Error("datasetId is required");
  return invokeIpcHandler("nlp:recommend-model", datasetId);
}

// ---------------------------------------------------------------------------
// On-Chain Asset Bridge handlers
// ---------------------------------------------------------------------------

async function handleOnchainGetOwnedTokens(body: Record<string, unknown>) {
  const walletAddress = body.walletAddress as string;
  if (!walletAddress) throw new Error("walletAddress is required");
  return invokeIpcHandler("onchain-bridge:get-owned-tokens", walletAddress);
}

async function handleOnchainImportToken(body: Record<string, unknown>) {
  return invokeIpcHandler("onchain-bridge:import-token", body);
}

async function handleOnchainImportAll(body: Record<string, unknown>) {
  const walletAddress = body.walletAddress as string;
  if (!walletAddress) throw new Error("walletAddress is required");
  return invokeIpcHandler("onchain-bridge:import-all", walletAddress);
}

async function handleOnchainBridgeStatus(_body: Record<string, unknown>) {
  return invokeIpcHandler("onchain-bridge:status");
}

// ---------------------------------------------------------------------------
// Agent Marketplace Autonomy handlers
// ---------------------------------------------------------------------------

async function handleAgentMarketBrowse(body: Record<string, unknown>) {
  return invokeIpcHandler("agent-market:browse", body);
}

async function handleAgentMarketRequestPurchase(body: Record<string, unknown>) {
  return invokeIpcHandler("agent-market:request-purchase", body);
}

async function handleAgentMarketRequestListing(body: Record<string, unknown>) {
  return invokeIpcHandler("agent-market:request-listing", body);
}

async function handleAgentMarketPendingIntents(_body: Record<string, unknown>) {
  return invokeIpcHandler("agent-market:pending-intents");
}

async function handleAgentMarketResolveIntent(body: Record<string, unknown>) {
  return invokeIpcHandler("agent-market:resolve-intent", body);
}

async function handleAgentMarketBrowseModels(body: Record<string, unknown>) {
  return invokeIpcHandler("agent-market:browse-models", body);
}

async function handleAgentMarketMyLicenses(body: Record<string, unknown>) {
  const walletAddress = body.walletAddress as string;
  if (!walletAddress) throw new Error("walletAddress is required");
  return invokeIpcHandler("agent-market:my-licenses", walletAddress);
}

async function handleAgentMarketPurchaseHistory(body: Record<string, unknown>) {
  const walletAddress = body.walletAddress as string;
  if (!walletAddress) throw new Error("walletAddress is required");
  return invokeIpcHandler("agent-market:purchase-history", walletAddress);
}

// ---------------------------------------------------------------------------
// Marketplace Sync & Subgraph handlers
// ---------------------------------------------------------------------------

async function handleMarketplaceSyncGetConfig(_body: Record<string, unknown>) {
  return invokeIpcHandler("marketplace-sync:get-config");
}

async function handleMarketplaceSyncListing(body: Record<string, unknown>) {
  return invokeIpcHandler("marketplace-sync:sync-listing", body);
}

async function handleMarketplaceGetActiveListings(_body: Record<string, unknown>) {
  return invokeIpcHandler("marketplace-sync:get-active-listings");
}

async function handleMarketplaceGetStoreByOwner(body: Record<string, unknown>) {
  const ownerAddress = body.ownerAddress as string;
  if (!ownerAddress) throw new Error("ownerAddress is required");
  return invokeIpcHandler("marketplace-sync:get-store-by-owner", ownerAddress);
}

async function handleMarketplaceGetDrops(_body: Record<string, unknown>) {
  return invokeIpcHandler("marketplace-sync:get-drops");
}

async function handleMarketplaceQuerySubgraph(body: Record<string, unknown>) {
  const subgraph = body.subgraph as string;
  const query = body.query as string;
  if (!subgraph || !query) throw new Error("subgraph and query are required");
  const channel = `marketplace-sync:query-${subgraph}-subgraph`;
  return invokeIpcHandler(channel, query, body.variables);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ROUTES: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
  "POST /api/projects/list": handleListProjects,
  "POST /api/projects/create": handleCreateProject,
  "POST /api/agents/list": handleListAgents,
  "POST /api/agents/create": handleCreateAgent,
  "POST /api/agents/get": handleGetAgent,
  "POST /api/agents/publish": handlePublishAgent,
  "POST /api/agents/update": handleUpdateAgent,
  "POST /api/agents/deploy": handleDeployAgent,
  "POST /api/agents/generate-prompt": handleGenerateAgentPrompt,
  "POST /api/agents/nlp-create": handleNlpCreateAgent,
  "POST /api/apps/list": handleListApps,
  "POST /api/apps/create": handleCreateApp,
  "POST /api/apps/get": handleGetApp,
  "POST /api/apps/build": handleBuildApp,
  "POST /api/apps/create-and-build": handleCreateAndBuildApp,
  "POST /api/apps/run": handleRunApp,
  "POST /api/apps/stop": handleStopApp,
  "POST /api/marketplace/status": handleMarketplaceStatus,
  // Email
  "POST /api/email/accounts": handleEmailAccountList,
  "POST /api/email/folders": handleEmailFoldersList,
  "POST /api/email/messages": handleEmailMessagesList,
  "POST /api/email/messages/get": handleEmailMessageGet,
  "POST /api/email/messages/search": handleEmailSearch,
  "POST /api/email/send": handleEmailSend,
  "POST /api/email/reply": handleEmailReply,
  "POST /api/email/mark-read": handleEmailMarkRead,
  "POST /api/email/move": handleEmailMove,
  "POST /api/email/delete": handleEmailDelete,
  "POST /api/email/ai/compose": handleEmailAiCompose,
  "POST /api/email/ai/reply": handleEmailAiReply,
  "POST /api/email/ai/smart-replies": handleEmailAiSmartReplies,
  "POST /api/email/ai/triage": handleEmailAiTriage,
  "POST /api/email/ai/summarize": handleEmailAiSummarize,
  "POST /api/email/ai/adjust-tone": handleEmailAiAdjustTone,
  "POST /api/email/ai/daily-digest": handleEmailAiDailyDigest,
  "POST /api/email/sync": handleEmailSyncNow,
  "POST /api/email/stats": handleEmailStats,
  // Documents
  "POST /api/documents/status": handleDocumentStatus,
  "POST /api/documents/list": handleDocumentList,
  "POST /api/documents/get": handleDocumentGet,
  "POST /api/documents/create": handleDocumentCreate,
  "POST /api/documents/ai-generate": handleDocumentAiGenerate,
  "POST /api/documents/read-content": handleDocumentReadContent,
  "POST /api/documents/update-content": handleDocumentUpdateContent,
  "POST /api/documents/export": handleDocumentExport,
  "POST /api/documents/delete": handleDocumentDelete,
  "POST /api/documents/ai-assist": handleDocumentAiAssist,
  // n8n Core
  "POST /api/n8n/start": handleN8nStart,
  "POST /api/n8n/stop": handleN8nStop,
  "POST /api/n8n/status": handleN8nStatus,
  "POST /api/n8n/set-api-key": handleN8nSetApiKey,
  "POST /api/n8n/db/configure": handleN8nDbConfigure,
  "POST /api/n8n/db/config": handleN8nDbGetConfig,
  // n8n Workflows (local)
  "POST /api/n8n/workflow/create": handleN8nWorkflowCreate,
  "POST /api/n8n/workflow/update": handleN8nWorkflowUpdate,
  "POST /api/n8n/workflow/get": handleN8nWorkflowGet,
  "POST /api/n8n/workflow/list": handleN8nWorkflowList,
  "POST /api/n8n/workflow/delete": handleN8nWorkflowDelete,
  "POST /api/n8n/workflow/activate": handleN8nWorkflowActivate,
  "POST /api/n8n/workflow/deactivate": handleN8nWorkflowDeactivate,
  "POST /api/n8n/workflow/execute": handleN8nWorkflowExecute,
  // n8n AI Generation
  "POST /api/n8n/workflow/generate": handleN8nWorkflowGenerate,
  "POST /api/n8n/meta-builder/create": handleN8nMetaBuilderCreate,
  "POST /api/n8n/setup-ollama": handleN8nSetupOllama,
  // n8n Connections
  "POST /api/n8n/connections/add": handleN8nAddConnection,
  "POST /api/n8n/connections/test": handleN8nTestConnection,
  "POST /api/n8n/connections/list": handleN8nListConnections,
  "POST /api/n8n/connections/remove": handleN8nRemoveConnection,
  // n8n Connection-scoped workflows
  "POST /api/n8n/conn/workflows/list": handleN8nConnListWorkflows,
  "POST /api/n8n/conn/workflows/get": handleN8nConnGetWorkflow,
  "POST /api/n8n/conn/workflows/create": handleN8nConnCreateWorkflow,
  "POST /api/n8n/conn/workflows/execute": handleN8nConnExecuteWorkflow,
  // n8n Webhooks
  "POST /api/n8n/webhooks/create": handleN8nCreateWebhook,
  "POST /api/n8n/webhooks/list": handleN8nListWebhooks,
  "POST /api/n8n/webhooks/delete": handleN8nDeleteWebhook,
  "POST /api/n8n/webhooks/toggle": handleN8nToggleWebhook,
  "POST /api/n8n/webhooks/history": handleN8nWebhookHistory,
  // n8n Templates
  "POST /api/n8n/templates/list": handleN8nListTemplates,
  "POST /api/n8n/templates/deploy": handleN8nDeployTemplate,
  // n8n Mappings
  "POST /api/n8n/mappings/create": handleN8nCreateMapping,
  "POST /api/n8n/mappings/list": handleN8nListMappings,
  "POST /api/n8n/mappings/sync": handleN8nSyncMapping,
  // n8n Server control
  "POST /api/n8n/server/start": handleN8nStartServer,
  "POST /api/n8n/server/stop": handleN8nStopServer,
  "POST /api/n8n/server/status": handleN8nGetServerStatus,
  // n8n Config
  "POST /api/n8n/config/get": handleN8nGetConfig,
  "POST /api/n8n/config/update": handleN8nUpdateConfig,
  // Agent Triggers
  "POST /api/triggers/create": handleTriggerCreate,
  "POST /api/triggers/list": handleTriggerList,
  "POST /api/triggers/activate": handleTriggerActivate,
  "POST /api/triggers/pause": handleTriggerPause,
  "POST /api/triggers/delete": handleTriggerDelete,
  // Tool Catalog
  "POST /api/tools/catalog/list": handleToolCatalogList,
  "POST /api/tools/catalog/by-category": handleToolCatalogByCategory,
  "POST /api/tools/catalog/search": handleToolCatalogSearch,
  // Agent Stack
  "POST /api/agent-stack/build": handleAgentStackBuild,
  "POST /api/agent-stack/get": handleAgentStackGet,
  "POST /api/agent-stack/sync-n8n": handleAgentStackSyncN8n,
  // Agent Communication
  "POST /api/agent-comm/send": handleAgentSendMessage,
  "POST /api/agent-comm/messages": handleAgentGetMessages,
  "POST /api/agent-comm/collaboration/create": handleAgentCreateCollaboration,
  "POST /api/agent-comm/collaboration/list": handleAgentListCollaborations,
  "POST /api/agent-comm/collaboration/get": handleAgentGetCollaboration,
  "POST /api/agent-comm/collaboration/workflow": handleAgentCreateCollabWorkflow,
  // Workflow Marketplace
  "POST /api/workflows/publish": handleWorkflowPublish,
  "POST /api/workflows/install": handleWorkflowInstall,
  "POST /api/workflows/unpublish": handleWorkflowUnpublish,
  "POST /api/workflows/published": handleWorkflowListPublished,
  // Skills
  "POST /api/skills/list": handleSkillList,
  "POST /api/skills/get": handleSkillGet,
  "POST /api/skills/create": handleSkillCreate,
  "POST /api/skills/update": handleSkillUpdate,
  "POST /api/skills/delete": handleSkillDelete,
  "POST /api/skills/search": handleSkillSearch,
  "POST /api/skills/match": handleSkillMatch,
  "POST /api/skills/execute": handleSkillExecute,
  "POST /api/skills/generate": handleSkillGenerate,
  "POST /api/skills/auto-generate": handleSkillAutoGenerate,
  "POST /api/skills/attach-to-agent": handleSkillAttachToAgent,
  "POST /api/skills/detach-from-agent": handleSkillDetachFromAgent,
  "POST /api/skills/list-for-agent": handleSkillListForAgent,
  "POST /api/skills/export": handleSkillExport,
  "POST /api/skills/import": handleSkillImport,
  "POST /api/skills/export-md": handleSkillExportMd,
  "POST /api/skills/bootstrap": handleSkillBootstrap,
  "POST /api/skills/learn": handleSkillLearn,
  // Orchestrator
  "POST /api/orchestrator/status": handleOrchestratorStatus,
  "POST /api/orchestrator/submit-task": handleOrchestratorSubmitTask,
  "POST /api/orchestrator/get": handleOrchestratorGet,
  "POST /api/orchestrator/list": handleOrchestratorList,
  "POST /api/orchestrator/cancel": handleOrchestratorCancel,
  "POST /api/orchestrator/pause": handleOrchestratorPause,
  "POST /api/orchestrator/resume": handleOrchestratorResume,
  "POST /api/orchestrator/dashboard": handleOrchestratorDashboard,
  "POST /api/orchestrator/templates": handleOrchestratorTemplates,
  // Voice Assistant
  "POST /api/voice/get-config": handleVoiceGetConfig,
  "POST /api/voice/update-config": handleVoiceUpdateConfig,
  "POST /api/voice/get-state": handleVoiceGetState,
  "POST /api/voice/get-capabilities": handleVoiceGetCapabilities,
  "POST /api/voice/speak": handleVoiceSpeak,
  "POST /api/voice/transcribe-file": handleVoiceTranscribeFile,
  "POST /api/voice/get-installed-models": handleVoiceGetInstalledModels,
  // Analytics & Reporting
  "POST /api/analytics/global": handleAnalyticsGlobal,
  "POST /api/analytics/generate-report": handleAnalyticsGenerateReport,
  "POST /api/analytics/list-reports": handleAnalyticsListReports,
  "POST /api/analytics/get-report": handleAnalyticsGetReport,
  "POST /api/analytics/delete-report": handleAnalyticsDeleteReport,
  "POST /api/analytics/get-dashboard": handleAnalyticsGetDashboard,
  "POST /api/analytics/create-dashboard": handleAnalyticsCreateDashboard,
  // Version Control
  "POST /api/version/commit": handleVersionCommit,
  "POST /api/version/list": handleVersionList,
  "POST /api/version/get": handleVersionGet,
  "POST /api/version/diff": handleVersionDiff,
  "POST /api/version/rollback": handleVersionRollback,
  "POST /api/version/create-branch": handleVersionCreateBranch,
  "POST /api/version/list-branches": handleVersionListBranches,
  "POST /api/version/merge": handleVersionMerge,
  "POST /api/version/timeline": handleVersionTimeline,
  // Calendar
  "POST /api/calendar/list-sources": handleCalendarListSources,
  "POST /api/calendar/sync-all": handleCalendarSyncAll,
  "POST /api/calendar/get-event": handleCalendarGetEvent,
  "POST /api/calendar/export-ics": handleCalendarExportIcs,
  // Vector Store
  "POST /api/vector/list-collections": handleVectorListCollections,
  "POST /api/vector/get-collection": handleVectorGetCollection,
  "POST /api/vector/delete-collection": handleVectorDeleteCollection,
  "POST /api/vector/get-stats": handleVectorGetStats,
  // Image Studio
  "POST /api/image-studio/generate": handleImageStudioGenerate,
  "POST /api/image-studio/edit": handleImageStudioEdit,
  "POST /api/image-studio/list": handleImageStudioList,
  "POST /api/image-studio/get": handleImageStudioGet,
  "POST /api/image-studio/delete": handleImageStudioDelete,
  "POST /api/image-studio/available-providers": handleImageStudioAvailableProviders,
  "POST /api/image-studio/enhance-prompt": handleImageStudioEnhancePrompt,
  // Dataset Studio
  "POST /api/dataset/create": handleDatasetCreate,
  "POST /api/dataset/list": handleDatasetList,
  "POST /api/dataset/get": handleDatasetGet,
  "POST /api/dataset/update": handleDatasetUpdate,
  "POST /api/dataset/delete": handleDatasetDelete,
  "POST /api/dataset/list-items": handleDatasetListItems,
  "POST /api/dataset/get-item": handleDatasetGetItem,
  "POST /api/dataset/export": handleDatasetExport,
  // GitHub
  "POST /api/github/list-repos": handleGithubListRepos,
  "POST /api/github/create-repo": handleGithubCreateRepo,
  "POST /api/github/push": handleGithubPush,
  // Marketplace Sync & Subgraph
  // NLP Pipeline
  "GET /api/nlp/engines": handleNlpListEngines,
  "GET /api/nlp/pipelines": handleNlpListPipelines,
  "POST /api/nlp/process-text": handleNlpProcessText,
  "POST /api/nlp/process-dataset": handleNlpProcessDataset,
  "POST /api/nlp/auto-tag-dataset": handleNlpAutoTagDataset,
  "POST /api/nlp/prepare-listing": handleNlpPrepareListing,
  "POST /api/nlp/publish-dataset": handleNlpPublishDataset,
  "POST /api/nlp/recommend-model": handleNlpRecommendModel,
  // On-Chain Asset Bridge
  "POST /api/onchain-bridge/get-owned-tokens": handleOnchainGetOwnedTokens,
  "POST /api/onchain-bridge/import-token": handleOnchainImportToken,
  "POST /api/onchain-bridge/import-all": handleOnchainImportAll,
  "GET /api/onchain-bridge/status": handleOnchainBridgeStatus,
  // Agent Marketplace Autonomy
  "POST /api/agent-market/browse": handleAgentMarketBrowse,
  "POST /api/agent-market/request-purchase": handleAgentMarketRequestPurchase,
  "POST /api/agent-market/request-listing": handleAgentMarketRequestListing,
  "GET /api/agent-market/pending-intents": handleAgentMarketPendingIntents,
  "POST /api/agent-market/resolve-intent": handleAgentMarketResolveIntent,
  "POST /api/agent-market/browse-models": handleAgentMarketBrowseModels,
  "POST /api/agent-market/my-licenses": handleAgentMarketMyLicenses,
  "POST /api/agent-market/purchase-history": handleAgentMarketPurchaseHistory,
  // Marketplace Sync & Subgraph
  "POST /api/marketplace-sync/get-config": handleMarketplaceSyncGetConfig,
  "POST /api/marketplace-sync/sync-listing": handleMarketplaceSyncListing,
  "POST /api/marketplace-sync/get-active-listings": handleMarketplaceGetActiveListings,
  "POST /api/marketplace-sync/get-store-by-owner": handleMarketplaceGetStoreByOwner,
  "POST /api/marketplace-sync/get-drops": handleMarketplaceGetDrops,
  "POST /api/marketplace-sync/query-subgraph": handleMarketplaceQuerySubgraph,
  // Library (personal file bookshelf)
  "POST /api/library/import-buffer": handleLibraryImportBuffer,
  "POST /api/library/list": handleLibraryList,
  "POST /api/library/get": handleLibraryGet,
  "POST /api/library/get-content": handleLibraryGetContent,
  "POST /api/library/update": handleLibraryUpdate,
  "POST /api/library/delete": handleLibraryDelete,
  "POST /api/library/store-to-ipfs": handleLibraryStoreToIpfs,
  "POST /api/library/pin-to-remote": handleLibraryPinToRemote,
  // Celestia Blob (decentralized data layer)
  "POST /api/celestia/status": handleCelestiaStatus,
  "POST /api/celestia/config/get": handleCelestiaConfigGet,
  "POST /api/celestia/config/update": handleCelestiaConfigUpdate,
  "POST /api/celestia/config/reset": handleCelestiaConfigReset,
  "POST /api/celestia/blob/submit": handleCelestiaBlobSubmit,
  "POST /api/celestia/blob/submit-json": handleCelestiaBlobSubmitJson,
  "POST /api/celestia/blob/submit-file": handleCelestiaBlobSubmitFile,
  "POST /api/celestia/blob/get": handleCelestiaBlobGet,
  "POST /api/celestia/blob/get-at-height": handleCelestiaBlobGetAtHeight,
  "POST /api/celestia/blob/list": handleCelestiaBlobList,
  "POST /api/celestia/blob/stats": handleCelestiaBlobStats,
  "POST /api/celestia/blob/hash": handleCelestiaBlobHash,
  "POST /api/celestia/blob/verify": handleCelestiaBlobVerify,
  "POST /api/celestia/namespace/generate": handleCelestiaNamespaceGenerate,
  "POST /api/celestia/wallet/validate": handleCelestiaWalletValidate,
  // Tokenomics
  "GET /api/tokenomics/stats": handleTokenomicsGetStats,
  "POST /api/tokenomics/stakes": handleTokenomicsGetStakes,
  "POST /api/tokenomics/create-stake": handleTokenomicsCreateStake,
  "POST /api/tokenomics/unstake": handleTokenomicsUnstake,
  "POST /api/tokenomics/earnings": handleTokenomicsGetEarnings,
  "POST /api/tokenomics/reputation": handleTokenomicsGetReputation,
  "POST /api/tokenomics/record-meter": handleTokenomicsRecordMeter,
  "GET /api/tokenomics/fee-schedule": handleTokenomicsGetFeeSchedule,
  "GET /api/tokenomics/reward-rules": handleTokenomicsGetRewardRules,
  "POST /api/tokenomics/create-billing": handleTokenomicsCreateBilling,
  "POST /api/tokenomics/billing-accounts": handleTokenomicsGetBillingAccounts,
  // A2A Protocol
  "POST /api/a2a/register-agent": handleA2ARegisterAgent,
  "GET /api/a2a/my-agents": handleA2AGetMyAgents,
  "POST /api/a2a/search-agents": handleA2ASearchAgents,
  "POST /api/a2a/get-agent": handleA2AGetAgent,
  "POST /api/a2a/create-task": handleA2ACreateTask,
  "POST /api/a2a/accept-task": handleA2AAcceptTask,
  "POST /api/a2a/get-tasks": handleA2AGetTasks,
  "GET /api/a2a/network-stats": handleA2AGetNetworkStats,
  "POST /api/a2a/complete-task": handleA2ACompleteTask,
  // Governance
  "GET /api/governance/stats": handleGovernanceGetStats,
  "POST /api/governance/create-proposal": handleGovernanceCreateProposal,
  "POST /api/governance/get-proposal": handleGovernanceGetProposal,
  "POST /api/governance/list-proposals": handleGovernanceListProposals,
  "POST /api/governance/cast-vote": handleGovernanceCastVote,
  "POST /api/governance/get-voting-power": handleGovernanceGetVotingPower,
  "POST /api/governance/delegate": handleGovernanceDelegate,
  "POST /api/governance/get-delegations": handleGovernanceGetDelegations,
  "GET /api/governance/treasury-stats": handleGovernanceGetTreasuryStats,
  "GET /api/governance/config": handleGovernanceGetConfig,
  "POST /api/governance/execute-proposal": handleGovernanceExecuteProposal,
};

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export async function startJoyCreateApiServer(): Promise<void> {
  if (server) return;

  // Generate a random token for this session
  apiToken = randomBytes(32).toString("hex");

  // Write token so OpenClaw plugin can read it
  const tokenDir = path.dirname(TOKEN_FILE);
  await fs.mkdir(tokenDir, { recursive: true });
  await fs.writeFile(TOKEN_FILE, apiToken, "utf-8");
  logger.info(`API token written to ${TOKEN_FILE}`);

  // Push the fresh token to the OpenClaw bridge (best-effort, non-blocking)
  pushTokenToBridge(apiToken).catch(() => {});

  server = http.createServer(async (req, res) => {
    // CORS — loopback only
    res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1");

    // Health check (no auth)
    if (req.url === "/healthz") {
      return json(res, { ok: true });
    }

    // Auth check
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${apiToken}`) {
      return error(res, "Unauthorized", 401);
    }

    const routeKey = `${req.method} ${req.url?.split("?")[0]}`;
    const handler = ROUTES[routeKey];

    if (!handler) {
      return error(res, `Unknown route: ${routeKey}`, 404);
    }

    try {
      const body = await readBody(req);
      const result = await handler(body);
      json(res, { ok: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`API error on ${routeKey}:`, msg);
      error(res, msg, 500);
    }
  });

  const tsConfig = getTailscaleConfig();
  const bindHost = tsConfig.enabled && tsConfig.exposeServices ? "0.0.0.0" : "127.0.0.1";

  server.listen(API_PORT, bindHost, () => {
    logger.info(`JoyCreate API server listening on http://${bindHost}:${API_PORT}`);
  });
}

export async function stopJoyCreateApiServer(): Promise<void> {
  if (!server) return;
  return new Promise((resolve) => {
    server!.close(() => {
      server = null;
      logger.info("JoyCreate API server stopped");
      resolve();
    });
  });
}
