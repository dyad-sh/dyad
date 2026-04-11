/**
 * CI/CD Pipeline Builder IPC Handlers
 *
 * Thin IPC wrapper over the pre-existing LocalCICDPipeline service.
 * Forwards EventEmitter events to all active renderer senders.
 */

import { ipcMain } from "electron";
import log from "electron-log";
import type { WebContents } from "electron";
import { localCICDPipeline } from "../../lib/local_cicd_pipeline";
import { safeSend } from "../utils/safe_sender";

const logger = log.scope("cicd-builder");

// Track all renderer WebContents that have interacted with CI/CD channels,
// so we can forward pipeline events to them.
const activeSenders = new Set<WebContents>();

function registerSender(sender: WebContents): void {
  if (activeSenders.has(sender)) return;
  activeSenders.add(sender);
  sender.once("destroyed", () => activeSenders.delete(sender));
}

function broadcast(channel: string, payload: unknown): void {
  for (const sender of activeSenders) {
    safeSend(sender, channel, payload);
  }
}

// ── Lazy initialization ───────────────────────────────────────────────────────

let initialized = false;

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await localCICDPipeline.initialize();
  logger.info("LocalCICDPipeline initialized");
}

// ── Handler registration ──────────────────────────────────────────────────────

export function registerCICDBuilderHandlers(): void {
  logger.info("Registering CI/CD builder IPC handlers");

  // Wire up pipeline EventEmitter → renderer broadcasting
  localCICDPipeline.on("run:created", (run) =>
    broadcast("cicd:run-progress", { event: "run:created", run }),
  );
  localCICDPipeline.on("run:started", (run) =>
    broadcast("cicd:run-progress", { event: "run:started", run }),
  );
  localCICDPipeline.on("step:started", (payload) =>
    broadcast("cicd:log-line", { event: "step:started", ...payload }),
  );
  localCICDPipeline.on("step:completed", (payload) =>
    broadcast("cicd:log-line", { event: "step:completed", ...payload }),
  );
  localCICDPipeline.on("run:completed", (run) => {
    broadcast("cicd:run-complete", { event: "run:completed", run });
    broadcast("cicd:run-progress", { event: "run:completed", run });
  });
  localCICDPipeline.on("run:cancelled", (run) => {
    broadcast("cicd:run-progress", { event: "run:cancelled", run });
    broadcast("cicd:run-complete", { event: "run:cancelled", run });
  });

  // ── Templates ───────────────────────────────────────────────────────────────

  ipcMain.handle("cicd:get-templates", async (event) => {
    registerSender(event.sender);
    await ensureInitialized();
    return localCICDPipeline.getTemplates();
  });

  // ── Pipeline CRUD ────────────────────────────────────────────────────────────

  ipcMain.handle("cicd:list-pipelines", async (event) => {
    registerSender(event.sender);
    await ensureInitialized();
    return localCICDPipeline.listPipelines();
  });

  ipcMain.handle("cicd:get-pipeline", async (event, id: string) => {
    registerSender(event.sender);
    await ensureInitialized();
    return localCICDPipeline.getPipeline(id);
  });

  ipcMain.handle(
    "cicd:create-pipeline",
    async (
      event,
      params: {
        name: string;
        description?: string;
        workingDirectory: string;
        templateId?: string;
        env?: Record<string, string>;
      },
    ) => {
      registerSender(event.sender);
      await ensureInitialized();
      return localCICDPipeline.createPipeline(params);
    },
  );

  ipcMain.handle(
    "cicd:update-pipeline",
    async (event, id: string, updates: Record<string, unknown>) => {
      registerSender(event.sender);
      await ensureInitialized();
      return localCICDPipeline.updatePipeline(id, updates);
    },
  );

  ipcMain.handle("cicd:delete-pipeline", async (event, id: string) => {
    registerSender(event.sender);
    await ensureInitialized();
    return localCICDPipeline.deletePipeline(id);
  });

  ipcMain.handle(
    "cicd:create-from-template",
    async (
      event,
      templateId: string,
      workingDirectory: string,
      overrides?: { name?: string; description?: string },
    ) => {
      registerSender(event.sender);
      await ensureInitialized();
      const template = localCICDPipeline.getTemplate(templateId);
      if (!template) throw new Error(`Template not found: ${templateId}`);
      return localCICDPipeline.createPipeline({
        name: overrides?.name ?? template.name,
        description: overrides?.description ?? template.description,
        workingDirectory,
        templateId,
      });
    },
  );

  // ── Step Management ──────────────────────────────────────────────────────────

  ipcMain.handle(
    "cicd:add-step",
    async (event, pipelineId: string, step: Record<string, unknown>) => {
      registerSender(event.sender);
      await ensureInitialized();
      return localCICDPipeline.addStep(pipelineId, step);
    },
  );

  ipcMain.handle(
    "cicd:update-step",
    async (
      event,
      pipelineId: string,
      stepId: string,
      updates: Record<string, unknown>,
    ) => {
      registerSender(event.sender);
      await ensureInitialized();
      return localCICDPipeline.updateStep(pipelineId, stepId, updates);
    },
  );

  ipcMain.handle(
    "cicd:remove-step",
    async (event, pipelineId: string, stepId: string) => {
      registerSender(event.sender);
      await ensureInitialized();
      return localCICDPipeline.removeStep(pipelineId, stepId);
    },
  );

  ipcMain.handle(
    "cicd:reorder-steps",
    async (event, pipelineId: string, stepIds: string[]) => {
      registerSender(event.sender);
      await ensureInitialized();
      return localCICDPipeline.reorderSteps(pipelineId, stepIds);
    },
  );

  // ── Run Management ───────────────────────────────────────────────────────────

  ipcMain.handle(
    "cicd:run-pipeline",
    async (
      event,
      pipelineId: string,
      params?: {
        env?: Record<string, string>;
        branch?: string;
        commit?: string;
        trigger?: string;
      },
    ) => {
      registerSender(event.sender);
      await ensureInitialized();
      return localCICDPipeline.triggerRun(pipelineId, params);
    },
  );

  ipcMain.handle("cicd:cancel-run", async (event, runId: string) => {
    registerSender(event.sender);
    await ensureInitialized();
    return localCICDPipeline.cancelRun(runId);
  });

  ipcMain.handle(
    "cicd:list-runs",
    async (event, pipelineId?: string) => {
      registerSender(event.sender);
      await ensureInitialized();
      return localCICDPipeline.listRuns(pipelineId);
    },
  );

  ipcMain.handle("cicd:get-run", async (event, runId: string) => {
    registerSender(event.sender);
    await ensureInitialized();
    return localCICDPipeline.getRun(runId);
  });

  ipcMain.handle(
    "cicd:get-run-logs",
    async (event, runId: string, stepId?: string) => {
      registerSender(event.sender);
      await ensureInitialized();
      return localCICDPipeline.getRunLogs(runId, stepId);
    },
  );

  ipcMain.handle("cicd:delete-run", async (event, runId: string) => {
    registerSender(event.sender);
    await ensureInitialized();
    return localCICDPipeline.deleteRun(runId);
  });

  logger.info("CI/CD builder IPC handlers registered");
}
