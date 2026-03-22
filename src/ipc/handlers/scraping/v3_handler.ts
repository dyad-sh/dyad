/**
 * Scraping V3 IPC Handlers — New orchestrator-backed handlers.
 *
 * These supplement the existing V2 handlers in handler.ts, adding:
 *   - scraping:v3:quick-scrape        — orchestrator quick scrape
 *   - scraping:v3:create-job          — create persistent job
 *   - scraping:v3:run-job             — run a job
 *   - scraping:v3:pause-job           — pause running job
 *   - scraping:v3:cancel-job          — cancel job
 *   - scraping:v3:delete-job          — delete job
 *   - scraping:v3:get-job             — get job by ID
 *   - scraping:v3:list-jobs           — list all jobs
 *   - scraping:v3:get-results         — get results for a job
 *   - scraping:v3:probe-url           — probe a URL for engine selection
 *   - scraping:v3:export              — export job results
 *   - scraping:v3:create-schedule     — create scheduled job
 *   - scraping:v3:list-schedules      — list schedules
 *   - scraping:v3:toggle-schedule     — enable/disable schedule
 *   - scraping:v3:delete-schedule     — delete schedule
 *   - scraping:v3:create-template     — save user template
 *   - scraping:v3:list-templates      — list user templates
 *   - scraping:v3:delete-template     — delete user template
 *   - scraping:v3:list-sessions       — list auth sessions
 *   - scraping:v3:delete-session      — delete auth session
 *   - scraping:v3:import-cookies      — import cookies as session
 */

import { ipcMain, BrowserWindow, dialog } from "electron";
import log from "electron-log";
import {
  createJob,
  runJob,
  quickScrape,
  getJob,
  listJobs,
  cancelJob,
  pauseJob,
  resumeJob,
  deleteJob,
  getJobResults,
  createSchedule,
  listSchedules,
  toggleSchedule,
  deleteSchedule,
  createTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  probeUrl,
} from "@/lib/scraping";
import { exportData, getExportDir, detectPII, stripPII } from "@/lib/scraping/storage";
import {
  listSessions,
  deleteSession,
  parseCookieFile,
  importCookiesAsSession,
} from "@/lib/scraping/auth";
import type { ScrapingConfig } from "./types";
import type { EngineType, ExportOptions } from "@/lib/scraping/types";

const logger = log.scope("scraping:v3-handler");

export function registerScrapingV3Handlers(): void {
  // ── Quick Scrape ──────────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:v3:quick-scrape",
    async (_event, args: { url: string; engine?: EngineType }) => {
      return quickScrape(args.url, { engine: args.engine });
    },
  );

  // ── Probe URL ─────────────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:v3:probe-url",
    async (_event, url: string) => {
      return probeUrl(url);
    },
  );

  // ── Job CRUD ──────────────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:v3:create-job",
    async (
      _event,
      args: {
        name: string;
        config: ScrapingConfig;
        engine?: EngineType;
        templateId?: string;
        datasetId?: string;
      },
    ) => {
      const jobId = await createJob(args.name, args.config, {
        engine: args.engine,
        templateId: args.templateId,
        datasetId: args.datasetId,
      });
      return { jobId };
    },
  );

  ipcMain.handle(
    "scraping:v3:run-job",
    async (_event, jobId: string) => {
      // Run in background — don't await
      runJob(jobId).catch((err) => {
        logger.error(`Background job ${jobId} failed:`, err);
      });

      // Send progress updates to renderer
      const progressInterval = setInterval(async () => {
        try {
          const job = await getJob(jobId);
          if (!job) {
            clearInterval(progressInterval);
            return;
          }
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send("scraping:v3:job-progress", job);
          }
          if (
            job.status === "done" ||
            job.status === "failed" ||
            job.status === "cancelled"
          ) {
            clearInterval(progressInterval);
          }
        } catch {
          clearInterval(progressInterval);
        }
      }, 1000);

      return { jobId, status: "running" };
    },
  );

  ipcMain.handle("scraping:v3:pause-job", async (_event, jobId: string) => {
    await pauseJob(jobId);
    return { ok: true };
  });

  ipcMain.handle("scraping:v3:cancel-job", async (_event, jobId: string) => {
    await cancelJob(jobId);
    return { ok: true };
  });

  ipcMain.handle("scraping:v3:delete-job", async (_event, jobId: string) => {
    await deleteJob(jobId);
    return { ok: true };
  });

  ipcMain.handle("scraping:v3:resume-job", async (_event, jobId: string) => {
    await resumeJob(jobId);
    return { ok: true };
  });

  ipcMain.handle("scraping:v3:get-job", async (_event, jobId: string) => {
    const job = await getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    return job;
  });

  ipcMain.handle(
    "scraping:v3:list-jobs",
    async (_event, args?: { status?: string }) => {
      return listJobs(args?.status);
    },
  );

  // ── Results ───────────────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:v3:get-results",
    async (_event, jobId: string) => {
      return getJobResults(jobId);
    },
  );

  // ── Export ────────────────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:v3:export",
    async (
      _event,
      args: {
        jobId: string;
        format: ExportOptions["format"];
        stripPii?: boolean;
      },
    ) => {
      const results = await getJobResults(args.jobId);
      let data = results.map((r) => r.data as Record<string, unknown>);

      if (args.stripPii) {
        data = stripPII(data);
      }

      // Show save dialog
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: `${getExportDir()}/scraping-${args.jobId.slice(0, 8)}.${args.format}`,
        filters: [
          { name: "Export", extensions: [args.format === "jsonl" ? "jsonl" : args.format] },
        ],
      });

      if (!filePath) return { cancelled: true };

      return exportData(data, {
        format: args.format,
        outputPath: filePath,
        pretty: true,
      });
    },
  );

  // ── PII Detection ────────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:v3:detect-pii",
    async (_event, jobId: string) => {
      const results = await getJobResults(jobId);
      const data = results.map((r) => r.data as Record<string, unknown>);
      return detectPII(data);
    },
  );

  // ── Schedules ─────────────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:v3:create-schedule",
    async (
      _event,
      args: {
        name: string;
        jobConfig: Record<string, unknown>;
        cronExpression: string;
      },
    ) => {
      const id = await createSchedule(
        args.name,
        args.jobConfig,
        args.cronExpression,
      );
      return { id };
    },
  );

  ipcMain.handle("scraping:v3:list-schedules", async () => {
    return listSchedules();
  });

  ipcMain.handle(
    "scraping:v3:toggle-schedule",
    async (_event, args: { id: string; enabled: boolean }) => {
      await toggleSchedule(args.id, args.enabled);
      return { ok: true };
    },
  );

  ipcMain.handle("scraping:v3:delete-schedule", async (_event, id: string) => {
    await deleteSchedule(id);
    return { ok: true };
  });

  // ── User Templates ───────────────────────────────────────────────────

  ipcMain.handle(
    "scraping:v3:create-template",
    async (
      _event,
      args: {
        name: string;
        description: string;
        category: string;
        config: Record<string, unknown>;
      },
    ) => {
      const id = await createTemplate(
        args.name,
        args.description,
        args.category,
        args.config,
      );
      return { id };
    },
  );

  ipcMain.handle("scraping:v3:list-templates", async () => {
    return listTemplates();
  });

  ipcMain.handle("scraping:v3:get-template", async (_event, id: string) => {
    const template = await getTemplate(id);
    if (!template) throw new Error(`Template ${id} not found`);
    return template;
  });

  ipcMain.handle("scraping:v3:delete-template", async (_event, id: string) => {
    await deleteTemplate(id);
    return { ok: true };
  });

  // ── Auth Sessions ────────────────────────────────────────────────────

  ipcMain.handle("scraping:v3:list-sessions", async () => {
    return listSessions();
  });

  ipcMain.handle("scraping:v3:delete-session", async (_event, id: string) => {
    await deleteSession(id);
    return { ok: true };
  });

  ipcMain.handle(
    "scraping:v3:import-cookies",
    async (
      _event,
      args: { name: string; domain: string; cookieFileContent: string },
    ) => {
      const cookies = parseCookieFile(args.cookieFileContent);
      const session = await importCookiesAsSession(
        args.name,
        args.domain,
        cookies,
      );
      return session;
    },
  );

  logger.info("Scraping v3 handlers registered");
}
