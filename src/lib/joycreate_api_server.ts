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
import { randomBytes } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { app } from "electron";
import log from "electron-log";

import { getDb } from "@/db/index";
import { projects, apps, agents } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

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
// Router
// ---------------------------------------------------------------------------

const ROUTES: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
  "POST /api/projects/list": handleListProjects,
  "POST /api/projects/create": handleCreateProject,
  "POST /api/agents/list": handleListAgents,
  "POST /api/agents/create": handleCreateAgent,
  "POST /api/agents/get": handleGetAgent,
  "POST /api/agents/publish": handlePublishAgent,
  "POST /api/apps/list": handleListApps,
  "POST /api/marketplace/status": handleMarketplaceStatus,
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

  server.listen(API_PORT, "127.0.0.1", () => {
    logger.info(`JoyCreate API server listening on http://127.0.0.1:${API_PORT}`);
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
