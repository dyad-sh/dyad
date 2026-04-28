/**
 * OpenClaw IPC Handlers
 * Registers all IPC handlers for OpenClaw gateway integration
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from "electron";
import { v4 as uuidv4 } from "uuid";
import { execFile, exec } from "node:child_process";
import log from "electron-log";

import {
  getOpenClawGateway,
  OpenClawGatewayService,
} from "@/lib/openclaw_gateway_service";

import {
  getOpenClawDataPipeline,
  OpenClawDataPipelineService,
} from "@/lib/openclaw_data_pipeline";

import {
  getOpenClawSystemIntegration,
  OpenClawSystemIntegration,
} from "@/lib/openclaw_system_integration";

import { localAIHub } from "@/lib/local_ai_hub";

import type {
  OpenClawConfig,
  OpenClawAIProvider,
  OpenClawChatRequest,
  OpenClawAgentTask,
  ClaudeCodeConfig,
  ClaudeCodeTask,
  OpenClawEvent,
  OpenClawScrapingConfig,
  OpenClawImageGenConfig,
  OpenClawDataPipelineConfig,
  OpenClawDataRequest,
} from "@/types/openclaw_types";

const logger = log.scope("openclaw_handlers");

// Event subscription management
const eventSubscribers = new Map<number, () => void>();

export function registerOpenClawHandlers(): void {
  const gateway = getOpenClawGateway();

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  ipcMain.handle("openclaw:initialize", async () => {
    logger.info("Initializing OpenClaw...");
    await gateway.initialize();
    return { success: true };
  });

  ipcMain.handle("openclaw:shutdown", async () => {
    logger.info("Shutting down OpenClaw...");
    await gateway.shutdown();
    return { success: true };
  });

  // ===========================================================================
  // DAEMON WORKSPACE — point the daemon's agent workspace at a directory so
  // its Claude-Code-style tools can read & edit files there. Used to let the
  // OpenClaw portal operate directly inside the running JoyCreate repo so
  // users can modify the system and submit PRs back upstream.
  // ===========================================================================

  ipcMain.handle(
    "openclaw:set-daemon-workspace",
    async (_event, args: { path?: string; useJoyCreateRepo?: boolean }) => {
      const { readFileSync, writeFileSync, existsSync, statSync } = await import("node:fs");
      const { join, resolve, basename } = await import("node:path");
      const { homedir } = await import("node:os");
      const { app } = await import("electron");

      // Resolve target path. When useJoyCreateRepo is true, search a broad
      // list of candidate directories for the JoyCreate repo root.
      // In dev mode: process.cwd() IS the repo root.
      // In packaged mode: look up from app.getPath('exe') and
      //   app.getAppPath() until we find a package.json with name "joycreate".
      let targetPath: string | undefined = args.path;
      if (args.useJoyCreateRepo) {
        const exeDir = join(app.getPath("exe"), "..");
        const candidates: string[] = [
          process.cwd(),
          app.getAppPath(),
          join(app.getAppPath(), ".."),
          join(app.getAppPath(), "..", ".."),
          join(app.getAppPath(), "..", "..", ".."),
          exeDir,
          join(exeDir, ".."),
          join(exeDir, "..", ".."),
        ];
        // De-duplicate and resolve
        const seen = new Set<string>();
        for (const c of candidates) {
          const r = resolve(c);
          if (seen.has(r)) continue;
          seen.add(r);
          try {
            const pkg = join(r, "package.json");
            if (existsSync(pkg)) {
              const j = JSON.parse(readFileSync(pkg, "utf8"));
              if (
                typeof j?.name === "string" &&
                (j.name.toLowerCase() === "joycreate" || j.name.toLowerCase() === "joy-create")
              ) {
                targetPath = r;
                break;
              }
            }
          } catch { /* skip */ }
        }
        if (!targetPath) {
          throw new Error(
            "Could not auto-locate the JoyCreate repository root.\n\n" +
            "Tried: " + [...seen].join(", ") + "\n\n" +
            "Use the 'Browse…' option to pick the folder manually.",
          );
        }
      }

      if (!targetPath || !existsSync(targetPath) || !statSync(targetPath).isDirectory()) {
        throw new Error(`Workspace path does not exist or is not a directory: ${targetPath}`);
      }

      const cfgPath = join(homedir(), ".openclaw", "openclaw.json");
      if (!existsSync(cfgPath)) {
        throw new Error(`OpenClaw daemon config not found at ${cfgPath}`);
      }

      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      cfg.agents = cfg.agents ?? {};
      cfg.agents.defaults = cfg.agents.defaults ?? {};
      const previous = cfg.agents.defaults.workspace;
      cfg.agents.defaults.workspace = targetPath;

      // Write project context so the daemon understands the JoyCreate codebase
      // architecture without the user having to explain it every session.
      // OpenClaw reads `agents.defaults.instructions` as a persistent system
      // prompt prepended to every agent session.
      const agentsInstructionsPath = join(targetPath, "AGENTS.md");
      const claudeInstructionsPath = join(targetPath, "CLAUDE.md");
      let instructions: string | undefined;
      if (existsSync(agentsInstructionsPath)) {
        try { instructions = readFileSync(agentsInstructionsPath, "utf8"); } catch { /* skip */ }
      } else if (existsSync(claudeInstructionsPath)) {
        try { instructions = readFileSync(claudeInstructionsPath, "utf8"); } catch { /* skip */ }
      }

      if (instructions) {
        cfg.agents.defaults.instructions = instructions;
      }

      // Tell the daemon which files give codebase context it should read first
      cfg.agents.defaults.contextFiles = [
        "AGENTS.md",
        "CLAUDE.md",
        "src/ipc/ipc_client.ts",
        "src/preload.ts",
        "src/ipc/ipc_host.ts",
        "src/router.ts",
        "package.json",
      ].filter((f) => existsSync(join(targetPath as string, f)));

      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
      logger.info("Daemon workspace updated", { previous, next: targetPath });

      return {
        success: true,
        workspace: targetPath,
        previous,
        note:
          "Portal will reload with workspace → " + basename(targetPath) + ". " +
          "The daemon's file tools will now read and edit code in this directory.",
      };
    },
  );

  // Open a native folder-picker dialog and return the selected path.
  // Renderer calls this when auto-detection fails or the user wants to
  // manually choose a different workspace directory.
  ipcMain.handle("openclaw:pick-workspace-folder", async (event) => {
    const { dialog, BrowserWindow } = await import("electron");
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win!, {
      title: "Select JoyCreate repository folder",
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true, path: null };
    return { canceled: false, path: result.filePaths[0] };
  });

  ipcMain.handle("openclaw:get-daemon-workspace", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const cfgPath = join(homedir(), ".openclaw", "openclaw.json");
    if (!existsSync(cfgPath)) return { workspace: null };
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      return { workspace: cfg?.agents?.defaults?.workspace ?? null };
    } catch {
      return { workspace: null };
    }
  });

  // ===========================================================================
  // GATEWAY MANAGEMENT
  // ===========================================================================

  ipcMain.handle("openclaw:gateway:start", async () => {
    await gateway.startGateway();
    return { success: true };
  });

  ipcMain.handle("openclaw:gateway:stop", async () => {
    await gateway.stopGateway();
    return { success: true };
  });

  ipcMain.handle("openclaw:gateway:restart", async () => {
    await gateway.stopGateway();
    await gateway.startGateway();
    return { success: true };
  });

  // Spawn the external OpenClaw daemon and bridge to it.
  // The internal gateway keeps running on its own port — no downtime.
  ipcMain.handle("openclaw:gateway:yield-to-daemon", async () => {
    const homedir = require("node:os").homedir();
    const gatewayCmdPath = require("node:path").join(homedir, ".openclaw", "gateway.cmd");

    if (!require("node:fs").existsSync(gatewayCmdPath)) {
      throw new Error("gateway.cmd not found at " + gatewayCmdPath);
    }

    logger.info("Spawning external OpenClaw daemon...");

    // 1. Spawn the external daemon process (detached, survives JoyCreate restart)
    const child = execFile(gatewayCmdPath, [], {
      cwd: homedir,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: true,
    });
    child.unref();
    logger.info("External daemon process spawned (PID: " + child.pid + ")");

    // 2. Wait for the daemon to bind (up to 120 seconds — daemon loads many plugins)
    const daemonPort = gateway.getConfig().gateway?.daemonPort ?? 18790;
    const deadline = Date.now() + 120_000;
    let daemonReady = false;
    let probeCount = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      probeCount++;
      try {
        const resp = await fetch(`http://127.0.0.1:${daemonPort}/health`, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) { daemonReady = true; break; }
      } catch { /* not ready yet */ }
      if (probeCount % 10 === 0) {
        logger.info(`Waiting for daemon to bind... (${probeCount} probes, ${Math.round((Date.now() - (deadline - 120_000)) / 1000)}s elapsed)`);
      }
    }

    if (!daemonReady) {
      logger.warn("External daemon did not bind within 120s — internal gateway still serving");
      return { success: false, bridged: false, reason: "daemon_timeout" };
    }

    // 3. Bridge to the daemon (internal gateway stays running)
    const bridged = await gateway.bridgeToDaemon();
    logger.info("Bridge to daemon: " + bridged);

    return { success: true, bridged };
  });

  ipcMain.handle("openclaw:gateway:status", async () => {
    return gateway.getGatewayState();
  });

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  ipcMain.handle("openclaw:config:get", async () => {
    return gateway.getConfig();
  });

  ipcMain.handle("openclaw:gateway-token", async () => {
    // Try from environment first (loaded by dotenv)
    if (process.env.OPENCLAW_GATEWAY_TOKEN) {
      return process.env.OPENCLAW_GATEWAY_TOKEN;
    }
    // Fallback: read from .env file directly
    try {
      const { app } = await import("electron");
      const envPath = require("node:path").join(app.getAppPath(), ".env");
      const content = require("node:fs").readFileSync(envPath, "utf8");
      const match = content.match(/^OPENCLAW_GATEWAY_TOKEN=(.+)$/m);
      if (match?.[1]) {
        const token = match[1].trim();
        process.env.OPENCLAW_GATEWAY_TOKEN = token; // cache for next call
        return token;
      }
    } catch {
      // .env file not found or unreadable
    }
    // Fallback: read from daemon config (~/.openclaw/openclaw.json → gateway.auth.token)
    try {
      const nodeFs = require("node:fs") as typeof import("node:fs");
      const nodePath = require("node:path") as typeof import("node:path");
      const os = require("node:os") as typeof import("node:os");
      const cfgPath = nodePath.join(os.homedir(), ".openclaw", "openclaw.json");
      const raw = nodeFs.readFileSync(cfgPath, "utf8");
      const cfg = JSON.parse(raw);
      const token = cfg?.gateway?.auth?.token;
      if (typeof token === "string" && token.length > 0) {
        process.env.OPENCLAW_GATEWAY_TOKEN = token; // cache for next call
        return token;
      }
    } catch {
      // daemon config not found or unreadable
    }
    return "";
  });

  ipcMain.handle(
    "openclaw:config:update",
    async (_event: IpcMainInvokeEvent, updates: Partial<OpenClawConfig>) => {
      await gateway.updateConfig(updates);
      return { success: true };
    }
  );

  ipcMain.handle("openclaw:claude-code:config:get", async () => {
    return gateway.getClaudeCodeConfig();
  });

  ipcMain.handle(
    "openclaw:claude-code:config:update",
    async (_event: IpcMainInvokeEvent, updates: Partial<ClaudeCodeConfig>) => {
      await gateway.updateClaudeCodeConfig(updates);
      return { success: true };
    }
  );

  // ===========================================================================
  // PROVIDER MANAGEMENT
  // ===========================================================================

  ipcMain.handle("openclaw:provider:list", async () => {
    return gateway.getProviderStatus();
  });

  ipcMain.handle("openclaw:provider:health", async () => {
    return gateway.checkProviderHealth();
  });

  ipcMain.handle(
    "openclaw:provider:configure",
    async (
      _event: IpcMainInvokeEvent,
      params: { name: string; config: Partial<OpenClawAIProvider> }
    ) => {
      await gateway.configureProvider(params.name, params.config);
      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:provider:remove",
    async (_event: IpcMainInvokeEvent, name: string) => {
      await gateway.removeProvider(name);
      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:provider:set-api-key",
    async (
      _event: IpcMainInvokeEvent,
      params: { provider: string; apiKey: string }
    ) => {
      await gateway.configureProvider(params.provider, {
        apiKey: params.apiKey,
        enabled: true,
      });
      return { success: true };
    }
  );

  // ===========================================================================
  // CHAT & COMPLETION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:chat",
    async (_event: IpcMainInvokeEvent, request: OpenClawChatRequest) => {
      return gateway.chat(request);
    }
  );

  ipcMain.handle(
    "openclaw:chat:stream",
    async (event: IpcMainInvokeEvent, request: OpenClawChatRequest) => {
      const requestId = uuidv4();
      
      // Set up streaming handler
      const streamHandler = (chunk: any) => {
        try {
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win && !win.isDestroyed()) {
            win.webContents.send("openclaw:chat:stream-chunk", {
              requestId,
              chunk,
            });
          }
        } catch {
          // Window closed
        }
      };
      
      gateway.on("chat:stream", streamHandler);
      
      try {
        const response = await gateway.chat({ ...request, stream: true });
        gateway.off("chat:stream", streamHandler);
        return { requestId, response };
      } catch (error) {
        gateway.off("chat:stream", streamHandler);
        throw error;
      }
    }
  );

  // ===========================================================================
  // AGENT TASKS
  // ===========================================================================

  ipcMain.handle(
    "openclaw:agent:execute-task",
    async (_event: IpcMainInvokeEvent, task: OpenClawAgentTask) => {
      if (!task.id) {
        task.id = uuidv4();
      }
      return gateway.executeAgentTask(task);
    }
  );

  ipcMain.handle(
    "openclaw:agent:execute-with-n8n",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        task: OpenClawAgentTask;
        workflowId?: string;
        triggerWorkflow?: boolean;
      }
    ) => {
      const { task, workflowId, triggerWorkflow } = params;
      
      if (!task.id) {
        task.id = uuidv4();
      }
      
      // Execute the agent task
      const result = await gateway.executeAgentTask(task);
      
      // Optionally trigger n8n workflow with results
      if (triggerWorkflow && workflowId) {
        await gateway.triggerN8nWorkflow(workflowId, {
          taskId: task.id,
          taskType: task.type,
          result,
        });
      }
      
      return result;
    }
  );

  // ===========================================================================
  // CLAUDE CODE
  // ===========================================================================

  ipcMain.handle(
    "openclaw:claude-code:execute",
    async (_event: IpcMainInvokeEvent, task: ClaudeCodeTask) => {
      if (!task.id) {
        task.id = uuidv4();
      }
      return gateway.executeClaudeCodeTask(task);
    }
  );

  ipcMain.handle(
    "openclaw:claude-code:batch",
    async (_event: IpcMainInvokeEvent, tasks: ClaudeCodeTask[]) => {
      const results = [];
      for (const task of tasks) {
        if (!task.id) {
          task.id = uuidv4();
        }
        const result = await gateway.executeClaudeCodeTask(task);
        results.push(result);
        
        // Stop on error unless in batch mode
        if (!result.success) {
          break;
        }
      }
      return results;
    }
  );

  // ===========================================================================
  // N8N INTEGRATION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:n8n:trigger-workflow",
    async (
      _event: IpcMainInvokeEvent,
      params: { workflowId: string; data: unknown }
    ) => {
      await gateway.triggerN8nWorkflow(params.workflowId, params.data);
      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:n8n:create-agent-workflow",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        name: string;
        agentType: string;
        objective: string;
        triggerType: "webhook" | "schedule" | "manual";
        schedule?: string;
      }
    ) => {
      // Create an n8n workflow that executes OpenClaw agent tasks
      const workflowTemplate = {
        name: params.name,
        nodes: [
          {
            id: "trigger",
            name: params.triggerType === "webhook" ? "Webhook Trigger" : 
                  params.triggerType === "schedule" ? "Schedule Trigger" : "Manual Trigger",
            type: params.triggerType === "webhook" ? "n8n-nodes-base.webhook" :
                  params.triggerType === "schedule" ? "n8n-nodes-base.scheduleTrigger" : 
                  "n8n-nodes-base.manualTrigger",
            position: [0, 0],
            parameters: params.triggerType === "schedule" && params.schedule ? {
              rule: { interval: [{ field: "hours", hoursInterval: parseInt(params.schedule) || 24 }] },
            } : {},
          },
          {
            id: "OpenClaw-agent",
            name: "OpenClaw Agent",
            type: "n8n-nodes-base.httpRequest",
            position: [200, 0],
            parameters: {
              method: "POST",
              url: "http://localhost:5679/api/OpenClaw/agent",
              body: JSON.stringify({
                type: params.agentType,
                objective: params.objective,
                input: "={{$json}}",
              }),
            },
          },
        ],
        connections: {
          trigger: { main: [[{ node: "OpenClaw-agent", type: "main", index: 0 }]] },
        },
      };
      
      // Emit event for n8n handlers to create the workflow
      gateway.emit("n8n:create-workflow", workflowTemplate);
      
      return { success: true, workflow: workflowTemplate };
    }
  );

  // ===========================================================================
  // AUTONOMOUS CREATION INTEGRATION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:autonomous:create-app",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        name: string;
        description: string;
        features: string[];
        techStack?: string[];
        useLocal?: boolean;
      }
    ) => {
      const task: OpenClawAgentTask = {
        id: uuidv4(),
        type: "build",
        objective: `Create a new application called "${params.name}".
        
Description: ${params.description}

Features to implement:
${params.features.map((f, i) => `${i + 1}. ${f}`).join("\n")}

${params.techStack?.length ? `Tech stack: ${params.techStack.join(", ")}` : ""}

Please provide:
1. Project structure
2. Main files and their content
3. Dependencies to install
4. Setup instructions`,
        constraints: [
          "Follow best practices",
          "Include error handling",
          "Add comments for complex logic",
        ],
        preferLocal: params.useLocal ?? true,
      };
      
      return gateway.executeAgentTask(task);
    }
  );

  ipcMain.handle(
    "openclaw:autonomous:refactor-code",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        code: string;
        language: string;
        instructions: string;
        useLocal?: boolean;
      }
    ) => {
      const task: OpenClawAgentTask = {
        id: uuidv4(),
        type: "optimize",
        objective: `Refactor the following ${params.language} code:

\`\`\`${params.language}
${params.code}
\`\`\`

Instructions: ${params.instructions}

Please provide the refactored code with explanations for each change.`,
        preferLocal: params.useLocal ?? true,
      };
      
      return gateway.executeAgentTask(task);
    }
  );

  ipcMain.handle(
    "openclaw:autonomous:analyze-codebase",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        files: Array<{ path: string; content: string }>;
        analysisType: "security" | "performance" | "quality" | "all";
        useLocal?: boolean;
      }
    ) => {
      const fileList = params.files
        .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      
      const task: OpenClawAgentTask = {
        id: uuidv4(),
        type: "analyze",
        objective: `Analyze the following codebase for ${params.analysisType === "all" ? "security, performance, and code quality" : params.analysisType} issues:

${fileList}

Please provide:
1. Summary of findings
2. Specific issues with file paths and line numbers
3. Recommendations for improvement
4. Priority rating for each issue`,
        preferLocal: params.useLocal ?? false, // Complex analysis benefits from cloud
      };
      
      return gateway.executeAgentTask(task);
    }
  );

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  ipcMain.handle("openclaw:subscribe", async (event: IpcMainInvokeEvent) => {
    const webContentsId = event.sender.id;

    // Remove existing subscription
    const existingUnsubscribe = eventSubscribers.get(webContentsId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }

    // Set up event listener
    const listener = (OpenClawEvent: OpenClawEvent) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          win.webContents.send("openclaw:event", OpenClawEvent);
        }
      } catch {
        // Window closed
      }
    };

    gateway.on("event", listener);

    // Store cleanup function
    eventSubscribers.set(webContentsId, () => {
      gateway.off("event", listener);
    });

    return { success: true };
  });

  ipcMain.handle("openclaw:unsubscribe", async (event: IpcMainInvokeEvent) => {
    const webContentsId = event.sender.id;
    const unsubscribe = eventSubscribers.get(webContentsId);

    if (unsubscribe) {
      unsubscribe();
      eventSubscribers.delete(webContentsId);
    }

    return { success: true };
  });

  // ===========================================================================
  // QUICK ACTIONS
  // ===========================================================================

  ipcMain.handle(
    "openclaw:quick:generate-code",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        prompt: string;
        language?: string;
        context?: string;
        useLocal?: boolean;
      }
    ) => {
      const response = await gateway.chat({
        messages: [
          {
            role: "system",
            content: `You are an expert programmer. Generate clean, well-documented code.
${params.language ? `Use ${params.language}.` : ""}
${params.context ? `Context: ${params.context}` : ""}`,
          },
          {
            role: "user",
            content: params.prompt,
          },
        ],
        capabilities: ["code"],
      });

      return {
        code: response.message.content,
        provider: response.provider,
        model: response.model,
        localProcessed: response.localProcessed,
      };
    }
  );

  ipcMain.handle(
    "openclaw:quick:explain-code",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        code: string;
        language?: string;
        detail?: "brief" | "detailed" | "beginner";
      }
    ) => {
      const detailPrompt = {
        brief: "Give a brief explanation.",
        detailed: "Explain in detail including the logic and patterns used.",
        beginner: "Explain as if to a beginner programmer.",
      };

      const response = await gateway.chat({
        messages: [
          {
            role: "system",
            content: "You are an expert programmer who explains code clearly.",
          },
          {
            role: "user",
            content: `Explain this ${params.language || ""} code:

\`\`\`${params.language || ""}
${params.code}
\`\`\`

${detailPrompt[params.detail || "detailed"]}`,
          },
        ],
        capabilities: ["code", "analysis"],
      });

      return {
        explanation: response.message.content,
        provider: response.provider,
        localProcessed: response.localProcessed,
      };
    }
  );

  ipcMain.handle(
    "openclaw:quick:fix-error",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        code: string;
        error: string;
        language?: string;
      }
    ) => {
      const response = await gateway.chat({
        messages: [
          {
            role: "system",
            content: "You are an expert debugger. Fix errors and explain the solution.",
          },
          {
            role: "user",
            content: `Fix this ${params.language || ""} code error:

Code:
\`\`\`${params.language || ""}
${params.code}
\`\`\`

Error:
${params.error}

Provide the fixed code and explain what was wrong.`,
          },
        ],
        capabilities: ["code", "reasoning"],
      });

      return {
        fix: response.message.content,
        provider: response.provider,
        localProcessed: response.localProcessed,
      };
    }
  );

  // ===========================================================================
  // DATA PIPELINE - SCRAPING
  // ===========================================================================

  const dataPipeline = getOpenClawDataPipeline();

  ipcMain.handle("openclaw:data:initialize", async () => {
    logger.info("Initializing OpenClaw Data Pipeline...");
    await dataPipeline.initialize();
    return { success: true, providers: dataPipeline.getAvailableProviders() };
  });

  ipcMain.handle(
    "openclaw:data:scrape",
    async (_event: IpcMainInvokeEvent, config: OpenClawScrapingConfig) => {
      logger.info("Starting AI-enhanced scraping", { urls: config.urls.length });
      return await dataPipeline.scrape(config);
    }
  );

  ipcMain.handle(
    "openclaw:data:scrape:single",
    async (_event: IpcMainInvokeEvent, url: string, options?: Partial<OpenClawScrapingConfig>) => {
      logger.info("Scraping single URL", { url });
      const config: OpenClawScrapingConfig = {
        urls: [url],
        type: "web",
        ...options,
      };
      const results = await dataPipeline.scrape(config);
      return results[0];
    }
  );

  // ===========================================================================
  // DATA PIPELINE - IMAGE GENERATION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:data:image:generate",
    async (_event: IpcMainInvokeEvent, config: OpenClawImageGenConfig) => {
      logger.info("Generating image with AI enhancement", { 
        prompt: config.prompt.slice(0, 50),
        aiEnhancement: config.aiPromptEnhancement?.enabled,
      });
      return await dataPipeline.generateImage(config);
    }
  );

  ipcMain.handle(
    "openclaw:data:image:enhance-prompt",
    async (
      _event: IpcMainInvokeEvent,
      prompt: string,
      options?: { style?: string; preferLocal?: boolean }
    ) => {
      logger.info("Enhancing image prompt with AI", { prompt: prompt.slice(0, 50) });
      
      // Use the gateway for quick prompt enhancement
      const response = await gateway.chat({
        messages: [
          {
            role: "system",
            content: `You are an expert at crafting prompts for AI image generation models like Stable Diffusion.
Enhance the user's prompt to produce higher quality, more detailed images.
${options?.style ? `Apply this style: ${options.style}` : ""}
Add quality enhancing terms like 'highly detailed', '8k', 'professional'.
Keep the enhanced prompt under 200 words. Respond with ONLY the enhanced prompt.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        preferLocal: options?.preferLocal ?? true,
        capabilities: ["creative"],
      });

      return {
        originalPrompt: prompt,
        enhancedPrompt: response.message.content.trim().replace(/^["']|["']$/g, ""),
        provider: response.provider,
        localProcessed: response.localProcessed,
      };
    }
  );

  // ===========================================================================
  // DATA PIPELINE - PIPELINE ORCHESTRATION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:data:pipeline:run",
    async (_event: IpcMainInvokeEvent, config: OpenClawDataPipelineConfig) => {
      logger.info("Running data pipeline", { name: config.name, sources: config.sources.length });
      return await dataPipeline.runPipeline(config);
    }
  );

  ipcMain.handle(
    "openclaw:data:request",
    async (_event: IpcMainInvokeEvent, request: OpenClawDataRequest) => {
      logger.info("Handling unified data request", { type: request.type, requestId: request.requestId });
      return await dataPipeline.handleDataRequest(request);
    }
  );

  // ===========================================================================
  // DATA PIPELINE - JOB MANAGEMENT
  // ===========================================================================

  ipcMain.handle("openclaw:data:jobs:list", async () => {
    return dataPipeline.getActiveJobs();
  });

  ipcMain.handle(
    "openclaw:data:jobs:get",
    async (_event: IpcMainInvokeEvent, jobId: string) => {
      return dataPipeline.getJob(jobId);
    }
  );

  ipcMain.handle(
    "openclaw:data:jobs:cancel",
    async (_event: IpcMainInvokeEvent, jobId: string) => {
      return await dataPipeline.cancelJob(jobId);
    }
  );

  // ===========================================================================
  // DATA PIPELINE - EVENTS
  // ===========================================================================

  ipcMain.handle(
    "openclaw:data:events:subscribe",
    async (event: IpcMainInvokeEvent) => {
      const webContents = event.sender;
      const windowId = webContents.id;

      // Unsubscribe existing listener if any
      if (eventSubscribers.has(windowId)) {
        const unsub = eventSubscribers.get(windowId);
        unsub?.();
      }

      // Create event forwarder for data pipeline events
      const forwardEvent = (eventData: { jobId: string; [key: string]: unknown }) => {
        if (!webContents.isDestroyed()) {
          webContents.send("openclaw:data:event", eventData);
        }
      };

      // Subscribe to data pipeline events
      dataPipeline.on("job:started", forwardEvent);
      dataPipeline.on("job:progress", forwardEvent);
      dataPipeline.on("job:completed", forwardEvent);
      dataPipeline.on("job:failed", forwardEvent);
      dataPipeline.on("job:cancelled", forwardEvent);
      dataPipeline.on("pipeline:started", forwardEvent);
      dataPipeline.on("pipeline:completed", forwardEvent);
      dataPipeline.on("pipeline:failed", forwardEvent);

      // Store cleanup function
      const unsubscribe = () => {
        dataPipeline.off("job:started", forwardEvent);
        dataPipeline.off("job:progress", forwardEvent);
        dataPipeline.off("job:completed", forwardEvent);
        dataPipeline.off("job:failed", forwardEvent);
        dataPipeline.off("job:cancelled", forwardEvent);
        dataPipeline.off("pipeline:started", forwardEvent);
        dataPipeline.off("pipeline:completed", forwardEvent);
        dataPipeline.off("pipeline:failed", forwardEvent);
        eventSubscribers.delete(windowId);
      };

      eventSubscribers.set(windowId, unsubscribe);

      // Cleanup when window closes
      webContents.once("destroyed", () => {
        unsubscribe();
      });

      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:data:events:unsubscribe",
    async (event: IpcMainInvokeEvent) => {
      const windowId = event.sender.id;
      const unsub = eventSubscribers.get(windowId);
      if (unsub) {
        unsub();
        return { success: true };
      }
      return { success: false };
    }
  );

  // ===========================================================================
  // SYSTEM INTEGRATION
  // ===========================================================================

  const systemIntegration = getOpenClawSystemIntegration();

  ipcMain.handle("openclaw:system:initialize", async () => {
    logger.info("Initializing OpenClaw system integration...");
    await systemIntegration.initialize();
    
    // Also register LocalAIHub with OpenClaw
    await localAIHub.registerWithOpenClaw();
    
    return { success: true };
  });

  ipcMain.handle("openclaw:system:config:get", async () => {
    return systemIntegration.getConfig();
  });

  ipcMain.handle(
    "openclaw:system:config:update",
    async (_event: IpcMainInvokeEvent, updates: Record<string, unknown>) => {
      systemIntegration.updateConfig(updates as any);
      return { success: true };
    }
  );

  ipcMain.handle("openclaw:system:stats", async () => {
    return systemIntegration.getStats();
  });

  ipcMain.handle(
    "openclaw:system:history",
    async (_event: IpcMainInvokeEvent, limit?: number) => {
      return systemIntegration.getOperationHistory(limit || 100);
    }
  );

  ipcMain.handle(
    "openclaw:system:execute",
    async (_event: IpcMainInvokeEvent, request: {
      type: string;
      source: string;
      prompt?: string;
      messages?: Array<{ role: string; content: string }>;
      systemPrompt?: string;
      capabilities?: string[];
      metadata?: Record<string, unknown>;
    }) => {
      const response = await systemIntegration.execute({
        id: uuidv4(),
        type: request.type as any,
        source: request.source as any,
        prompt: request.prompt,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        capabilities: request.capabilities as any,
        metadata: request.metadata,
        timestamp: Date.now(),
      });
      return response;
    }
  );

  ipcMain.handle(
    "openclaw:system:chat",
    async (_event: IpcMainInvokeEvent, message: string, options?: {
      systemPrompt?: string;
      preferLocal?: boolean;
    }) => {
      const response = await systemIntegration.chat(message, options);
      return { success: true, content: response };
    }
  );

  ipcMain.handle(
    "openclaw:system:agent-inference",
    async (_event: IpcMainInvokeEvent, agentId: string, prompt: string, options?: {
      systemPrompt?: string;
      model?: string;
      temperature?: number;
    }) => {
      const response = await systemIntegration.agentInference(agentId, prompt, options);
      return { success: true, content: response };
    }
  );

  // ===========================================================================
  // LOCAL AI HUB INTEGRATION
  // ===========================================================================

  ipcMain.handle("openclaw:local-hub:status", async () => {
    return localAIHub.getAllProviderStatus();
  });

  ipcMain.handle(
    "openclaw:local-hub:chat",
    async (_event: IpcMainInvokeEvent, request: {
      prompt: string;
      systemPrompt?: string;
      messages?: Array<{ role: string; content: string }>;
      modelConfig: {
        modelId: string;
        provider?: string;
        options?: Record<string, unknown>;
      };
    }) => {
      // Convert messages to proper type
      const typedMessages = request.messages?.map(m => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      }));
      
      // Use OpenClaw-integrated chat (local first, cloud fallback)
      const response = await localAIHub.OpenClawChat({
        id: uuidv4(),
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        messages: typedMessages,
        modelConfig: request.modelConfig as any,
        timestamp: Date.now(),
      });
      return response;
    }
  );

  ipcMain.handle("openclaw:local-hub:combined-stats", async () => {
    return localAIHub.getCombinedStats();
  });

  // ===========================================================================
  // SYSTEM EVENTS SUBSCRIPTION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:system:events:subscribe",
    async (event: IpcMainInvokeEvent) => {
      const webContents = event.sender;
      const windowId = webContents.id;

      // Create event forwarder for system integration events
      const forwardEvent = (eventName: string) => (eventData: unknown) => {
        if (!webContents.isDestroyed()) {
          webContents.send("openclaw:system:event", { type: eventName, data: eventData });
        }
      };

      // Subscribe to system integration events
      const operationCompleted = forwardEvent("operation:completed");
      const operationFailed = forwardEvent("operation:failed");
      const providerSwitched = forwardEvent("provider:switched");
      const providerError = forwardEvent("provider:error");

      systemIntegration.on("operation:completed", operationCompleted);
      systemIntegration.on("operation:failed", operationFailed);
      systemIntegration.on("provider:switched", providerSwitched);
      systemIntegration.on("provider:error", providerError);

      // Store cleanup function with unique key
      const systemKey = windowId + 1000000; // Offset to avoid collision
      const unsubscribe = () => {
        systemIntegration.off("operation:completed", operationCompleted);
        systemIntegration.off("operation:failed", operationFailed);
        systemIntegration.off("provider:switched", providerSwitched);
        systemIntegration.off("provider:error", providerError);
        eventSubscribers.delete(systemKey);
      };

      eventSubscribers.set(systemKey, unsubscribe);

      // Cleanup when window closes
      webContents.once("destroyed", () => {
        unsubscribe();
      });

      return { success: true };
    }
  );

  // ===========================================================================
  // DAEMON AUTO-START (Windows Startup Folder)
  // ===========================================================================

  const STARTUP_LINK_NAME = "OpenClaw Gateway.lnk";

  /** Build the path to the Windows Startup folder shortcut. */
  function getStartupLinkPath(): string {
    const { app } = require("electron") as typeof import("electron");
    const path = require("node:path") as typeof import("node:path");
    return path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup", STARTUP_LINK_NAME);
  }

  /**
   * Query whether the OpenClaw Gateway startup shortcut exists.
   */
  ipcMain.handle("openclaw:daemon:autostart-status", async () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const linkPath = getStartupLinkPath();
    const exists = fs.existsSync(linkPath);
    return { registered: exists, enabled: exists };
  });

  /**
   * Create or delete the startup shortcut that launches `gateway.cmd` at logon.
   * enable=true  → create a .vbs wrapper + shortcut in Startup folder
   * enable=false → delete the shortcut (and wrapper)
   */
  ipcMain.handle(
    "openclaw:daemon:autostart-set",
    async (_event: IpcMainInvokeEvent, enable: boolean) => {
      const os = require("node:os") as typeof import("node:os");
      const path = require("node:path") as typeof import("node:path");
      const fs = require("node:fs") as typeof import("node:fs");
      const linkPath = getStartupLinkPath();

      if (enable) {
        const gatewayCmdPath = path.join(os.homedir(), ".openclaw", "gateway.cmd");
        if (!fs.existsSync(gatewayCmdPath)) {
          throw new Error("gateway.cmd not found at " + gatewayCmdPath);
        }

        // Create a VBScript wrapper that launches gateway.cmd hidden (no console window)
        const vbsPath = path.join(os.homedir(), ".openclaw", "start-gateway-hidden.vbs");
        const escapedCmd = gatewayCmdPath.replace(/\\/g, "\\\\");
        const vbsContent = [
          `Set WshShell = CreateObject("WScript.Shell")`,
          `WshShell.Run """${escapedCmd}""", 0, False`,
        ].join("\r\n");
        fs.writeFileSync(vbsPath, vbsContent, "utf8");

        // Use PowerShell to create a .lnk shortcut pointing at the VBS wrapper
        const psScript = [
          `$ws = New-Object -ComObject WScript.Shell;`,
          `$sc = $ws.CreateShortcut('${linkPath.replace(/'/g, "''")}');`,
          `$sc.TargetPath = '${vbsPath.replace(/'/g, "''")}';`,
          `$sc.WorkingDirectory = '${path.dirname(gatewayCmdPath).replace(/'/g, "''")}';`,
          `$sc.Description = 'OpenClaw Gateway - auto-start';`,
          `$sc.Save()`,
        ].join(" ");

        await new Promise<void>((resolve, reject) => {
          exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`,
            { windowsHide: true },
            (err) => err ? reject(err) : resolve(),
          );
        });

        logger.info("OpenClaw daemon auto-start shortcut created at " + linkPath);
        return { registered: true, enabled: true };
      } else {
        // Remove shortcut
        try { fs.unlinkSync(linkPath); } catch { /* already gone */ }
        // Remove VBS wrapper too
        const vbsPath = path.join(os.homedir(), ".openclaw", "start-gateway-hidden.vbs");
        try { fs.unlinkSync(vbsPath); } catch { /* already gone */ }
        logger.info("OpenClaw daemon auto-start shortcut removed");
        return { registered: false, enabled: false };
      }
    },
  );

  logger.info("OpenClaw IPC handlers registered");
}
