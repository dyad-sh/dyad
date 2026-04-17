/**
 * OpenClaw Gateway Service
 * Local WebSocket gateway that connects JoyCreate to AI providers
 * and integrates with n8n workflows and autonomous agent systems
 */

import { EventEmitter } from "node:events";
import { app } from "electron";
import * as path from "node:path";
import * as fs from "fs-extra";
import * as nodeFs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import log from "electron-log";
import WebSocket, { WebSocketServer } from "ws";
import http from "node:http";

import type {
  OpenClawConfig,
  OpenClawGatewayState,
  OpenClawGatewayStatus,
  OpenClawMessage,
  OpenClawMessageType,
  OpenClawChatRequest,
  OpenClawChatResponse,
  OpenClawChatMessage,
  OpenClawStreamChunk,
  OpenClawAIProvider,
  OpenClawAgentTask,
  OpenClawAgentTaskResult,
  OpenClawEvent,
  OpenClawEventType,
  OpenClawCapability,
  ClaudeCodeConfig,
  ClaudeCodeTask,
  ClaudeCodeResult,
} from "@/types/openclaw_types";

import {
  DEFAULT_OPENCLAW_CONFIG,
  DEFAULT_CLAUDE_CODE_CONFIG,
} from "@/types/openclaw_types";

const logger = log.scope("openclaw_gateway");

// =============================================================================
// GATEWAY SERVICE
// =============================================================================

export class OpenClawGatewayService extends EventEmitter {
  private static instance: OpenClawGatewayService;
  
  private config: OpenClawConfig;
  private claudeCodeConfig: ClaudeCodeConfig;
  private state: OpenClawGatewayState;
  private server: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private providerHealthCache: Map<string, { healthy: boolean; lastCheck: number }> = new Map();
  
  /** True when connected as a WS client to an external OpenClaw gateway */
  private bridgeMode = false;
  /** WebSocket client used in bridge mode */
  private bridgeClient: WebSocket | null = null;
  private bridgeReconnectTimer: NodeJS.Timeout | null = null;
  /** True when an external gateway is reachable via HTTP health (even if WS bridge fails) */
  private externalGatewayAlive = false;
  /** Count of consecutive bridge WS connect failures (to throttle retries) */
  private bridgeConnectFailures = 0;
  /** Timestamp of last daemon respawn attempt (to throttle) */
  private lastDaemonRespawnAt = 0;
  /** Whether a daemon respawn is currently in progress */
  private daemonRespawning = false;
  
  private constructor() {
    super();
    this.config = { ...DEFAULT_OPENCLAW_CONFIG };
    this.claudeCodeConfig = { ...DEFAULT_CLAUDE_CODE_CONFIG };
    this.state = {
      status: "disconnected",
      reconnectAttempts: 0,
      activePlugins: [],
      connectedClients: 0,
    };
  }
  
  static getInstance(): OpenClawGatewayService {
    if (!OpenClawGatewayService.instance) {
      OpenClawGatewayService.instance = new OpenClawGatewayService();
    }
    return OpenClawGatewayService.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing OpenClaw Gateway Service...");
    
    await this.loadConfig();
    
    if (this.config.gateway.enabled && !this.server && !this.bridgeMode) {
      await this.startGateway();
    }
    
    // Check provider health
    await this.checkProviderHealth();
    
    logger.info("OpenClaw Gateway Service initialized");
  }
  
  async shutdown(): Promise<void> {
    logger.info("Shutting down OpenClaw Gateway Service...");
    
    await this.stopGateway();
    await this.saveConfig();
    
    this.removeAllListeners();
    logger.info("OpenClaw Gateway Service shut down");
  }
  
  // ===========================================================================
  // CONFIG MANAGEMENT
  // ===========================================================================
  
  private getConfigPath(): string {
    return path.join(app.getPath("userData"), "OpenClaw", "OpenClaw.json");
  }

  /** Read the auth token from the daemon's own config (~/.openclaw/openclaw.json) */
  private resolveDaemonAuthToken(): string {
    try {
      const daemonConfigPath = path.join(app.getPath("home"), ".openclaw", "openclaw.json");
      const raw = nodeFs.readFileSync(daemonConfigPath, "utf8");
      const cfg = JSON.parse(raw);
      return cfg?.gateway?.auth?.token || "";
    } catch {
      return "";
    }
  }
  
  private getClaudeCodeConfigPath(): string {
    return path.join(app.getPath("userData"), "OpenClaw", "claude-code.json");
  }
  
  async loadConfig(): Promise<void> {
    try {
      const configPath = this.getConfigPath();
      if (await fs.pathExists(configPath)) {
        const saved = await fs.readJson(configPath);
        // Deep merge to preserve nested defaults (e.g. gateway.host when only gateway.port is saved)
        for (const key of Object.keys(saved)) {
          if (typeof saved[key] === "object" && saved[key] !== null && !Array.isArray(saved[key]) && key in this.config) {
            (this.config as any)[key] = { ...(this.config as any)[key], ...saved[key] };
          } else {
            (this.config as any)[key] = saved[key];
          }
        }
      }

      // Internal gateway always uses the default port — never conflict with external daemon
      this.config.gateway.port = DEFAULT_OPENCLAW_CONFIG.gateway.port;
      this.config.gateway.daemonPort = this.config.gateway.daemonPort ?? DEFAULT_OPENCLAW_CONFIG.gateway.daemonPort;
      
      const claudeCodePath = this.getClaudeCodeConfigPath();
      if (await fs.pathExists(claudeCodePath)) {
        const saved = await fs.readJson(claudeCodePath);
        this.claudeCodeConfig = { ...DEFAULT_CLAUDE_CODE_CONFIG, ...saved };
      }
      
      logger.info("Configuration loaded");
    } catch (error) {
      logger.error("Failed to load config:", error);
    }
  }
  
  async saveConfig(): Promise<void> {
    try {
      const configDir = path.dirname(this.getConfigPath());
      await fs.ensureDir(configDir);
      
      await fs.writeJson(this.getConfigPath(), this.config, { spaces: 2 });
      await fs.writeJson(this.getClaudeCodeConfigPath(), this.claudeCodeConfig, { spaces: 2 });
      
      logger.info("Configuration saved");
    } catch (error) {
      logger.error("Failed to save config:", error);
    }
  }
  
  getConfig(): OpenClawConfig {
    return { ...this.config };
  }
  
  async updateConfig(updates: Partial<OpenClawConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await this.saveConfig();
    this.emitEvent("gateway:connected", { config: this.config });
  }
  
  getClaudeCodeConfig(): ClaudeCodeConfig {
    return { ...this.claudeCodeConfig };
  }
  
  async updateClaudeCodeConfig(updates: Partial<ClaudeCodeConfig>): Promise<void> {
    this.claudeCodeConfig = { ...this.claudeCodeConfig, ...updates };
    await this.saveConfig();
  }
  
  // ===========================================================================
  // GATEWAY MANAGEMENT
  // ===========================================================================
  
  async startGateway(): Promise<void> {
    if (this.server) {
      logger.warn("Gateway already running");
      return;
    }
    
    try {
      this.updateStatus("connecting");
      
      const { host, port } = this.config.gateway;
      
      // ── Always start our own server on the internal port ──
      // Create HTTP server for control UI + API
      this.httpServer = http.createServer((req, res) => {
        const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
        const pathname = parsedUrl.pathname;

        // API endpoints take priority
        if (pathname === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(this.getGatewayState()));
        } else if (pathname === "/api/status") {
          res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({
            status: this.state.status,
            connectedAt: this.state.connectedAt,
            lastHeartbeat: this.state.lastHeartbeat,
            connectedClients: this.state.connectedClients,
            version: this.state.version,
            providers: this.getProviderStatus(),
            config: {
              routing: this.config.routing,
              security: { allowRemoteConnections: this.config.security.allowRemoteConnections },
            },
          }));
        } else if (pathname === "/status") {
          // Keep legacy endpoint
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: this.state.status,
            providers: this.getProviderStatus(),
          }));
        } else if ((pathname.startsWith("/api/") || pathname.startsWith("/__openclaw/")) && this.externalGatewayAlive) {
          // Proxy API + config requests to the external daemon so the control-ui SPA works
          this.proxyToDaemon(req, res);
        } else if (!this.serveControlUiFile(req, res)) {
          // Control UI assets not found — show fallback
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.getDashboardHtml());
        }
      });
      
      // Create WebSocket server
      this.server = new WebSocketServer({ server: this.httpServer });
      
      this.server.on("connection", (ws, req) => {
        this.handleNewConnection(ws, req);
      });
      
      this.server.on("error", (error) => {
        logger.error("WebSocket server error:", error);
        this.updateStatus("error", error.message);
      });
      
      // Try to bind the local server. If port is already taken (e.g. daemon's
      // acpx browser plugin occupies 18792), skip the local server and go
      // straight to bridge-only mode.
      let localServerUp = false;
      try {
        await new Promise<void>((resolve, reject) => {
          this.httpServer!.listen(port, host, () => {
            logger.info(`Gateway running on ws://${host}:${port}`);
            resolve();
          });
          this.httpServer!.on("error", reject);
        });
        localServerUp = true;
      } catch (listenErr: any) {
        if (listenErr?.code === "EADDRINUSE") {
          logger.warn(`Port ${port} already in use (daemon plugin?) — skipping local server, will bridge directly`);
          // Clean up the objects we just created
          this.server?.close();
          this.server = null;
          this.httpServer = null;
        } else {
          throw listenErr; // unexpected error, re-throw
        }
      }
      
      if (localServerUp) {
        this.updateStatus("connected");
        this.state.connectedAt = Date.now();
        this.state.version = "1.0.0";
        
        // Start heartbeat
        this.startHeartbeat();
        
        this.emitEvent("gateway:connected", {
          host,
          port,
          url: `ws://${host}:${port}`,
        });
      }
      
      // ── Check if external daemon is running — bridge to it if so ──
      // Daemon can take up to 30s to fully start, so retry the probe
      const daemonPort = this.config.gateway.daemonPort ?? 18790;
      const daemonHost = host === "0.0.0.0" ? "127.0.0.1" : host;
      const maxAttempts = 45; // 45 × 2s timeout = ~90s — daemon loads many plugins
      let bridged = false;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const externalAlive = await this.probeExternalGateway(daemonHost, daemonPort);
        if (externalAlive) {
          logger.info(`External OpenClaw daemon detected on ${daemonHost}:${daemonPort} (attempt ${attempt}) — bridging`);
          await this.startBridgeMode(daemonHost, daemonPort);
          bridged = true;
          if (!localServerUp) {
            // We skipped the local server but bridge is up — mark connected
            this.updateStatus("connected");
            this.state.connectedAt = Date.now();
            this.state.version = "1.0.0";
            this.startHeartbeat();
            this.emitEvent("gateway:connected", { host, port: daemonPort, url: `ws://${daemonHost}:${daemonPort}` });
          }
          break;
        }
        if (attempt < maxAttempts) {
          logger.debug(`Daemon probe attempt ${attempt}/${maxAttempts} — not ready yet`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!bridged && !localServerUp) {
        // Port occupied but daemon not reachable — error state
        logger.error("Port occupied and daemon unreachable — gateway cannot start");
        this.updateStatus("error", `Port ${port} in use and daemon not reachable`);
      } else if (!bridged) {
        logger.info("External daemon not detected after probing — attempting to spawn it");
        // Try to spawn the daemon in the background; don't block gateway startup
        this.respawnDaemon().then((ok) => {
          if (ok) logger.info("Daemon spawned and bridged during startup");
          else logger.info("Daemon spawn attempt did not succeed — running standalone");
        }).catch(() => {});
      }
      
    } catch (error: any) {
      logger.error("Failed to start gateway:", error);
      this.updateStatus("error", error.message);
      throw error;
    }
  }
  
  async stopGateway(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    // ── Bridge mode cleanup ──
    if (this.bridgeReconnectTimer) {
      clearInterval(this.bridgeReconnectTimer);
      this.bridgeReconnectTimer = null;
    }
    if (this.bridgeClient) {
      try { this.bridgeClient.close(1000, "JoyCreate shutting down"); } catch { /* ignore */ }
      this.bridgeClient = null;
      this.bridgeMode = false;
    }
    this.externalGatewayAlive = false;
    this.bridgeConnectFailures = 0;
    
    // Close all client connections
    for (const [id, ws] of this.clients) {
      try {
        ws.close(1000, "Gateway shutting down");
      } catch {
        // Ignore
      }
    }
    this.clients.clear();
    
    // Close servers
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
    
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }
    
    this.updateStatus("disconnected");
    this.emitEvent("gateway:disconnected", {});
  }
  
  // ===========================================================================
  // BRIDGE MODE — connect as WS client to an external OpenClaw gateway
  // ===========================================================================
  
  /** HTTP probe to see if an external gateway is listening */
  private async probeExternalGateway(host: string, port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const req = http.get({ hostname: host === "0.0.0.0" ? "127.0.0.1" : host, port, path: "/health", timeout: 2000 }, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            // Accept any valid JSON response from /health as proof of life
            resolve(data && typeof data === "object");
          } catch {
            resolve(false);
          }
        });
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    });
  }
  
  /** Connect as a WS client to the external gateway and mirror events locally */
  private async startBridgeMode(host: string, port: number): Promise<void> {
    const wsHost = host === "0.0.0.0" ? "127.0.0.1" : host;
    const url = `ws://${wsHost}:${port}`;
    
    // Mark external gateway as alive — even if WS bridge fails, the gateway IS running
    this.externalGatewayAlive = true;
    this.state.connectedAt = this.state.connectedAt || Date.now();

    // If the daemon's config has Telegram enabled, stop the local bot to avoid
    // 409 Conflict loops from two pollers on the same token.
    try {
      const daemonConfigPath = path.join(app.getPath("home"), ".openclaw", "openclaw.json");
      if (nodeFs.existsSync(daemonConfigPath)) {
        const raw = nodeFs.readFileSync(daemonConfigPath, "utf8");
        const daemonCfg = JSON.parse(raw);
        if (daemonCfg?.channels?.telegram?.enabled && daemonCfg?.channels?.telegram?.botToken) {
          const { getTelegramBot } = await import("@/lib/telegram_bot_service");
          const localBot = getTelegramBot();
          if (localBot.getStatus().running) {
            logger.info("Stopping local Telegram bot — daemon handles Telegram");
            await localBot.stop();
          }
        }
      }
    } catch (err) {
      logger.warn("Failed to check/stop local Telegram bot during bridge:", err);
    }
    
    // Start a periodic health check that maintains the alive flag
    if (!this.bridgeReconnectTimer) {
      this.bridgeReconnectTimer = setInterval(async () => {
        const alive = await this.probeExternalGateway(wsHost, port);
        this.externalGatewayAlive = alive;
        if (alive) {
          // Try WS bridge reconnect if not connected (throttled)
          if (!this.bridgeClient || this.bridgeClient.readyState !== WebSocket.OPEN) {
            if (this.bridgeConnectFailures < 3) {
              this.attemptBridgeWs(wsHost, port);
            }
          }
        } else {
          // External gateway went down — internal server is still running
          this.externalGatewayAlive = false;
          this.bridgeClient = null;
          this.bridgeMode = false;
          logger.warn("External daemon no longer reachable — attempting auto-respawn");
          // Auto-respawn the daemon (throttled internally)
          this.respawnDaemon().catch((err) =>
            logger.warn("Auto-respawn from bridge health timer failed:", err),
          );
        }
      }, 15_000);
    }
    
    // Attempt the WS bridge (non-blocking — status is already "connected")
    this.attemptBridgeWs(wsHost, port);
  }

  /** Non-blocking attempt to establish WS bridge to external gateway */
  private attemptBridgeWs(wsHost: string, port: number): void {
    const url = `ws://${wsHost}:${port}`;
    
    try {
      const ws = new WebSocket(url);
      const connectTimeout = setTimeout(() => { ws.terminate(); }, 5000);

      ws.on("open", () => {
        clearTimeout(connectTimeout);
        this.bridgeClient = ws;
        this.bridgeMode = true;
        // Don't reset bridgeConnectFailures here — the server may accept the WS
        // upgrade but then reject the connect frame with 1008, causing an
        // infinite retry loop if we reset the counter on every open event.
        
        // Send the OpenClaw protocol connect frame
        const token = process.env.OPENCLAW_GATEWAY_TOKEN || this.resolveDaemonAuthToken();
        const connectFrame = {
          type: "req",
          method: "connect",
          id: uuidv4(),
          params: {
            client: {
              id: "gateway-client",
              displayName: "JoyCreate",
              mode: "backend",
              version: app.getVersion(),
              platform: "electron",
            },
            ...(token ? { auth: { token } } : {}),
            minProtocol: 3,
            maxProtocol: 3,
            role: "operator",
            scopes: ["operator.admin"],
          },
        };
        ws.send(JSON.stringify(connectFrame));
        
        this.emitEvent("gateway:connected", { host: wsHost, port, url, bridge: true });
        logger.info(`Bridge WS connected to external gateway at ${url}`);
      });
      
      ws.on("message", (data: Buffer | string) => {
        try {
          const raw = data.toString();
          const message = JSON.parse(raw);
          // Successfully receiving messages means bridge is fully working
          this.bridgeConnectFailures = 0;
          this.emitEvent("message:received", { clientId: "external-gateway", message });
          this.persistChannelMessage(message).catch(() => {});
          
          if (message.type === "heartbeat") {
            this.state.lastHeartbeat = Date.now();
          } else if (message.type) {
            this.emit(`bridge:${message.type}`, message);
          }

          // Forward daemon responses to connected control-ui clients
          for (const [, clientWs] of this.clients) {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(raw);
            }
          }
        } catch {
          logger.debug("Non-JSON message from external gateway, ignoring");
        }
      });
      
      ws.on("close", (code, reason) => {
        if (code === 1008) {
          // Protocol/auth rejection — don't spam reconnect, just log once
          this.bridgeConnectFailures++;
          if (this.bridgeConnectFailures <= 1) {
            logger.warn(`Bridge WS connect frame rejected (${code}): ${reason} — gateway is still reachable via HTTP`);
          }
        } else {
          logger.debug(`Bridge WS closed: ${code} ${reason}`);
        }
        this.bridgeClient = null;
        // Don't change status — externalGatewayAlive controls that now
      });
      
      ws.on("error", (error) => {
        clearTimeout(connectTimeout);
        this.bridgeConnectFailures++;
        logger.debug("Bridge WS error:", error.message);
        // Don't change status — externalGatewayAlive controls that
      });
    } catch (err) {
      this.bridgeConnectFailures++;
      logger.debug("Failed to create bridge WS:", err);
    }
  }
  
  /** Handle bridge disconnect — the periodic health timer will handle reconnect */
  private handleBridgeDisconnect(): void {
    this.bridgeClient = null;
    // If external gateway is still alive via HTTP, keep status as connected
    if (this.externalGatewayAlive) {
      return;
    }
    this.bridgeMode = false;
    // Internal server is always running — no need to restart anything
    logger.info("Bridge disconnected — internal gateway still serving");
  }
  
  /** Whether the service is operating in bridge mode (client to external gateway) */
  isBridged(): boolean {
    return this.bridgeMode;
  }

  /** Initiate a bridge to the external daemon (non-blocking, no restart needed) */
  async bridgeToDaemon(): Promise<boolean> {
    const daemonPort = this.config.gateway.daemonPort ?? 18790;
    const daemonHost = this.config.gateway.host === "0.0.0.0" ? "127.0.0.1" : this.config.gateway.host;
    const alive = await this.probeExternalGateway(daemonHost, daemonPort);
    if (!alive) return false;
    await this.startBridgeMode(daemonHost, daemonPort);
    return true;
  }

  /** Called by watchdog — single probe + bridge if daemon is reachable */
  async attemptBridge(): Promise<boolean> {
    if (this.bridgeMode) return true;
    return this.bridgeToDaemon();
  }

  /**
   * Respawn the external OpenClaw daemon process from ~/.openclaw/gateway.cmd.
   * Throttled: at most once per 60 seconds to avoid restart storms.
   * Returns true if daemon was respawned and is healthy.
   */
  async respawnDaemon(): Promise<boolean> {
    const RESPAWN_COOLDOWN_MS = 60_000;

    // Throttle respawns
    if (this.daemonRespawning) {
      logger.debug("Daemon respawn already in progress");
      return false;
    }
    if (Date.now() - this.lastDaemonRespawnAt < RESPAWN_COOLDOWN_MS) {
      logger.debug("Daemon respawn throttled — last attempt was recent");
      return false;
    }

    const homedir = require("node:os").homedir();
    const gatewayCmdPath = path.join(homedir, ".openclaw", "gateway.cmd");
    if (!nodeFs.existsSync(gatewayCmdPath)) {
      logger.warn("Cannot respawn daemon — gateway.cmd not found at " + gatewayCmdPath);
      return false;
    }

    this.daemonRespawning = true;
    this.lastDaemonRespawnAt = Date.now();

    try {
      logger.info("Respawning external OpenClaw daemon...");
      const { execFile } = require("node:child_process");
      const child = execFile(gatewayCmdPath, [], {
        cwd: homedir,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: true,
      });
      child.unref();
      logger.info("Daemon process spawned (PID: " + child.pid + ")");

      // Wait for daemon to bind (up to 120 seconds — daemon loads many plugins)
      const daemonPort = this.config.gateway.daemonPort ?? 18790;
      const deadline = Date.now() + 120_000;
      let attempt = 0;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        attempt++;
        const alive = await this.probeExternalGateway("127.0.0.1", daemonPort);
        if (alive) {
          logger.info(`Daemon respawned and healthy after ${attempt} probes — bridging`);
          this.bridgeConnectFailures = 0;
          await this.startBridgeMode("127.0.0.1", daemonPort);
          this.daemonRespawning = false;
          return true;
        }
        if (attempt % 10 === 0) {
          logger.info(`Waiting for daemon... (${attempt} probes, ${Math.round((Date.now() - this.lastDaemonRespawnAt) / 1000)}s elapsed)`);
        }
      }

      logger.warn("Daemon respawn timed out — daemon did not bind within 120s");
      this.daemonRespawning = false;
      return false;
    } catch (err) {
      logger.error("Daemon respawn failed:", err);
      this.daemonRespawning = false;
      return false;
    }
  }
  
  private handleNewConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const clientId = uuidv4();
    const origin = req.headers.origin || "unknown";
    
    // Check security
    if (!this.isOriginAllowed(origin)) {
      logger.warn(`Rejected connection from disallowed origin: "${origin}" (allowed: ${JSON.stringify(this.config.security.allowedOrigins)})`);
      ws.close(4003, "Origin not allowed");
      return;
    }
    
    logger.info(`New client connected: ${clientId}`);
    this.clients.set(clientId, ws);
    this.state.connectedClients = this.clients.size;
    
    ws.on("message", async (data) => {
      try {
        const message: OpenClawMessage = JSON.parse(data.toString());
        await this.handleMessage(clientId, message);
      } catch (error) {
        logger.error("Failed to parse message:", error);
        this.sendError(ws, "Invalid message format");
      }
    });
    
    ws.on("close", () => {
      logger.info(`Client disconnected: ${clientId}`);
      this.clients.delete(clientId);
      this.state.connectedClients = this.clients.size;
    });
    
    ws.on("error", (error) => {
      logger.error(`Client error (${clientId}):`, error);
    });
    
    // Send welcome message
    this.sendToClient(clientId, {
      id: uuidv4(),
      type: "control",
      from: { type: "system", id: "gateway" },
      payload: {
        action: "welcome",
        clientId,
        providers: Object.keys(this.config.aiProviders).filter(
          (k) => this.config.aiProviders[k].enabled
        ),
      },
      timestamp: Date.now(),
    });
  }
  
  private isOriginAllowed(origin: string): boolean {
    logger.debug(`[isOriginAllowed] Checking origin: "${origin}", allowRemoteConnections: ${this.config.security.allowRemoteConnections}`);
    
    // Always allow "unknown", empty, or "null" origin (e.g., from file:// or some WebSocket clients)
    if (!origin || origin === "unknown" || origin === "" || origin === "null") {
      logger.debug(`[isOriginAllowed] Allowing empty/unknown/null origin`);
      return true;
    }
    
    // If allowRemoteConnections is true, allow everything
    if (this.config.security.allowRemoteConnections) {
      logger.debug(`[isOriginAllowed] allowRemoteConnections=true, allowing all`);
      return true;
    }
    
    // Quick check: always allow localhost and 127.0.0.1 regardless of port
    if (origin.startsWith("http://localhost:") || 
        origin.startsWith("http://127.0.0.1:") ||
        origin.startsWith("https://localhost:") ||
        origin.startsWith("https://127.0.0.1:") ||
        origin.startsWith("file://") ||
        origin === "http://localhost" ||
        origin === "http://127.0.0.1") {
      logger.debug(`[isOriginAllowed] Quick-allowing local origin: "${origin}"`);
      return true;
    }
    
    // Normalize 127.0.0.1 to localhost so both forms match the same patterns
    const normalizedOrigin = origin.replace("://127.0.0.1", "://localhost");
    const allowedPatterns = this.config.security.allowedOrigins || [];
    
    // Always include default patterns if somehow missing
    const patternsToCheck = [
      ...allowedPatterns,
      "http://localhost:*",
      "http://127.0.0.1:*",
      "file://*",
    ];
    // Remove duplicates
    const uniquePatterns = [...new Set(patternsToCheck)];
    
    logger.debug(`[isOriginAllowed] Testing against patterns: ${JSON.stringify(uniquePatterns)}`);
    
    const matched = uniquePatterns.some((pattern) => {
      // 1. Replace glob * with a placeholder before escaping
      const placeholder = "<<GLOB>>";
      const withPlaceholder = pattern.replace(/\*/g, placeholder);
      // 2. Escape all regex special chars
      const escaped = withPlaceholder.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      // 3. Restore glob wildcards as .*
      const regexStr = escaped.replace(/<<GLOB>>/g, ".*");
      const regex = new RegExp(`^${regexStr}$`);
      const matchesOriginal = regex.test(origin);
      const matchesNormalized = regex.test(normalizedOrigin);
      if (matchesOriginal || matchesNormalized) {
        logger.debug(`[isOriginAllowed] Pattern "${pattern}" matched`);
      }
      return matchesOriginal || matchesNormalized;
    });
    
    if (!matched) {
      logger.warn(`[isOriginAllowed] No pattern matched origin "${origin}"`);
    }
    return matched;
  }
  
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.state.lastHeartbeat = Date.now();
      
      // Broadcast heartbeat to all clients
      for (const [id] of this.clients) {
        this.sendToClient(id, {
          id: uuidv4(),
          type: "heartbeat",
          from: { type: "system", id: "gateway" },
          payload: { timestamp: Date.now() },
          timestamp: Date.now(),
        });
      }
      
      // Check provider health periodically
      this.checkProviderHealth().catch((e) => logger.error("Health check failed:", e));
    }, this.config.gateway.heartbeatInterval);
  }
  
  // ===========================================================================
  // MESSAGE HANDLING
  // ===========================================================================
  
  private async handleMessage(clientId: string, message: OpenClawMessage): Promise<void> {
    logger.debug(`Received message from ${clientId}:`, message.type);
    
    try {
      switch (message.type) {
        case "chat":
          await this.handleChatMessage(clientId, message);
          break;
        case "completion":
          await this.handleCompletionMessage(clientId, message);
          break;
        case "agent-task":
          await this.handleAgentTask(clientId, message);
          break;
        case "tool-call":
          await this.handleToolCall(clientId, message);
          break;
        case "control":
          await this.handleControlMessage(clientId, message);
          break;
        case "heartbeat":
          // Just acknowledge
          break;
        default:
          // Forward unknown protocol messages (e.g. "req") to daemon when bridged
          if (this.bridgeClient && this.bridgeClient.readyState === WebSocket.OPEN) {
            this.bridgeClient.send(JSON.stringify(message));
          } else {
            logger.warn(`Unknown message type: ${message.type}`);
          }
      }
      
      this.emitEvent("message:received", { clientId, message });
    } catch (error: any) {
      logger.error("Message handling error:", error);
      const ws = this.clients.get(clientId);
      if (ws) {
        this.sendError(ws, error.message, message.id);
      } else {
        // External client (Telegram, etc.) — emit error as response:external
        this.emit("response:external", {
          clientId,
          message: {
            id: uuidv4(),
            type: "error",
            from: { type: "system", id: "gateway" },
            payload: { error: error.message },
            timestamp: Date.now(),
            replyTo: message.id,
          },
        });
      }
    }
  }
  
  private async handleChatMessage(clientId: string, message: OpenClawMessage): Promise<void> {
    const request = message.payload as OpenClawChatRequest;
    const provider = await this.selectProvider(request.capabilities);
    
    if (!provider) {
      throw new Error("No suitable provider available");
    }
    
    this.emitEvent("provider:switched", { provider: provider.name });
    
    const startTime = Date.now();
    let response: OpenClawChatResponse;
    
    try {
      if (request.stream) {
        // Handle streaming
        await this.streamChat(clientId, message.id, provider, request);
        return;
      }
      
      response = await this.executeChat(provider, request);
      response.latencyMs = Date.now() - startTime;
      response.localProcessed = provider.type === "ollama" || provider.type === "lmstudio";
      
    } catch (error: any) {
      // Try fallback provider
      if (this.config.fallbackProvider && provider.name !== this.config.fallbackProvider) {
        const fallback = this.config.aiProviders[this.config.fallbackProvider];
        if (fallback?.enabled) {
          logger.info(`Falling back to ${fallback.name}`);
          response = await this.executeChat(fallback, request);
          response.latencyMs = Date.now() - startTime;
          response.localProcessed = false;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    
    this.sendToClient(clientId, {
      id: uuidv4(),
      type: "chat",
      from: { type: "assistant", id: provider.name },
      to: { type: "provider", id: clientId },
      payload: response,
      timestamp: Date.now(),
      replyTo: message.id,
      metadata: {
        provider: response.provider,
        model: response.model,
        tokensUsed: response.usage.totalTokens,
        latencyMs: response.latencyMs,
        localProcessed: response.localProcessed,
      },
    });
  }
  
  private async executeChat(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    switch (provider.type) {
      case "ollama":
        return this.executeChatOllama(provider, request);
      case "anthropic":
        return this.executeChatAnthropic(provider, request);
      case "openai":
      case "deepseek":
      case "openai-compat":
        return this.executeChatOpenAI(provider, request);
      case "google":
        return this.executeChatGoogle(provider, request);
      case "lmstudio":
        return this.executeChatLMStudio(provider, request);
      case "claude-code":
        return this.executeChatClaudeCode(provider, request);
      default:
        throw new Error(`Unsupported provider type: ${provider.type}`);
    }
  }
  
  private async executeChatOllama(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    const baseURL = provider.baseURL || "http://localhost:11434";
    
    const response = await fetch(`${baseURL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model || provider.model,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        options: {
          temperature: request.temperature ?? provider.temperature ?? 0.7,
          num_predict: request.maxTokens ?? provider.maxTokens,
        },
        stream: false,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      id: uuidv4(),
      message: {
        role: "assistant",
        content: data.message.content,
      },
      finishReason: data.done ? "stop" : "length",
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      provider: provider.name,
      model: provider.model,
      latencyMs: 0,
      localProcessed: true,
    };
  }
  
  private async executeChatAnthropic(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    if (!provider.apiKey) {
      throw new Error("Anthropic API key not configured");
    }
    
    const messages = request.messages.filter((m) => m.role !== "system");
    const systemPrompt = request.messages.find((m) => m.role === "system")?.content || request.systemPrompt;
    
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model || provider.model,
        max_tokens: request.maxTokens || provider.maxTokens || 4096,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
        temperature: request.temperature ?? provider.temperature ?? 0.7,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Anthropic error: ${error.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      id: data.id,
      message: {
        role: "assistant",
        content: data.content[0].text,
      },
      finishReason: data.stop_reason === "end_turn" ? "stop" : data.stop_reason,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      provider: provider.name,
      model: data.model,
      latencyMs: 0,
      localProcessed: false,
    };
  }
  
  private async executeChatOpenAI(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    if (!provider.apiKey) {
      throw new Error(`${provider.name} API key not configured`);
    }

    const baseURL = provider.baseURL || "https://api.openai.com/v1";

    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || provider.model,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: request.temperature ?? provider.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? provider.maxTokens ?? 4096,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`${provider.name} error: ${(error as any).error?.message || response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices[0];

    return {
      id: data.id,
      message: {
        role: "assistant",
        content: choice.message.content,
      },
      finishReason: choice.finish_reason === "stop" ? "stop" : "length",
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      provider: provider.name,
      model: data.model,
      latencyMs: 0,
      localProcessed: false,
    };
  }

  private async executeChatGoogle(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    if (!provider.apiKey) {
      throw new Error("Google Gemini API key not configured");
    }

    const baseURL = provider.baseURL || "https://generativelanguage.googleapis.com/v1beta";
    const model = request.model || provider.model;

    // Convert OpenAI-style messages to Gemini format
    const systemInstruction = request.messages.find((m) => m.role === "system")?.content || request.systemPrompt;
    const contents = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const response = await fetch(
      `${baseURL}/models/${model}:generateContent?key=${encodeURIComponent(provider.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
          generationConfig: {
            temperature: request.temperature ?? provider.temperature ?? 0.7,
            maxOutputTokens: request.maxTokens ?? provider.maxTokens ?? 4096,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Google Gemini error: ${(error as any).error?.message || response.statusText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || "";

    return {
      id: uuidv4(),
      message: {
        role: "assistant",
        content: text,
      },
      finishReason: candidate?.finishReason === "STOP" ? "stop" : "length",
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount || 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0,
      },
      provider: provider.name,
      model,
      latencyMs: 0,
      localProcessed: false,
    };
  }

  private async executeChatLMStudio(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    const baseURL = provider.baseURL || "http://localhost:1234";
    
    const response = await fetch(`${baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model || provider.model,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: request.temperature ?? provider.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? provider.maxTokens,
        stream: false,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`LM Studio error: ${response.statusText}`);
    }
    
    const data = await response.json();
    const choice = data.choices[0];
    
    return {
      id: data.id,
      message: {
        role: "assistant",
        content: choice.message.content,
      },
      finishReason: choice.finish_reason === "stop" ? "stop" : "length",
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      provider: provider.name,
      model: data.model,
      latencyMs: 0,
      localProcessed: true,
    };
  }
  
  private async executeChatClaudeCode(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    // Claude Code is essentially Anthropic with additional agentic capabilities
    // For now, route through Anthropic with special system prompt
    const agenticSystemPrompt = `You are Claude Code, an AI coding assistant with file operation capabilities.
When the user asks you to perform file operations, analyze code, or make changes:
1. Think through the task step by step
2. Identify what files need to be read, created, or modified
3. Provide the changes in a structured format

${request.systemPrompt || ""}`;
    
    const modifiedRequest = {
      ...request,
      systemPrompt: agenticSystemPrompt,
    };
    
    return this.executeChatAnthropic(provider, modifiedRequest);
  }
  
  private async streamChat(
    clientId: string,
    requestId: string,
    provider: OpenClawAIProvider,
    request: OpenClawChatRequest
  ): Promise<void> {
    // Streaming implementation depends on provider
    // For brevity, using Ollama streaming as example
    const baseURL = provider.baseURL || "http://localhost:11434";
    
    const response = await fetch(`${baseURL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model || provider.model,
        messages: request.messages,
        stream: true,
      }),
    });
    
    if (!response.ok || !response.body) {
      throw new Error("Failed to start stream");
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(Boolean);
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            
            const streamChunk: OpenClawStreamChunk = {
              id: uuidv4(),
              delta: data.message?.content || "",
              finishReason: data.done ? "stop" : undefined,
            };
            
            this.sendToClient(clientId, {
              id: uuidv4(),
              type: "chat",
              from: { type: "assistant", id: provider.name },
              payload: { stream: true, chunk: streamChunk },
              timestamp: Date.now(),
              replyTo: requestId,
            });
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  
  private async handleCompletionMessage(clientId: string, message: OpenClawMessage): Promise<void> {
    // Simple text completion - route to chat with appropriate formatting
    const { prompt, ...options } = message.payload as { prompt: string } & Partial<OpenClawChatRequest>;
    
    const chatRequest: OpenClawChatRequest = {
      messages: [{ role: "user", content: prompt }],
      ...options,
    };
    
    const chatMessage: OpenClawMessage = {
      ...message,
      type: "chat",
      payload: chatRequest,
    };
    
    await this.handleChatMessage(clientId, chatMessage);
  }
  
  private async handleAgentTask(clientId: string, message: OpenClawMessage): Promise<void> {
    const task = message.payload as OpenClawAgentTask;
    
    this.emitEvent("agent:task:started", { taskId: task.id, task });
    
    // Determine provider based on task
    const capabilities: OpenClawCapability[] = ["agentic", "reasoning"];
    if (task.type === "build" || task.type === "analyze") {
      capabilities.push("code");
    }
    
    const provider = task.preferLocal
      ? this.config.aiProviders.ollama
      : await this.selectProvider(capabilities);
    
    if (!provider) {
      throw new Error("No suitable provider for agent task");
    }
    
    const result: OpenClawAgentTaskResult = {
      taskId: task.id,
      status: "completed",
      iterations: 1,
      tokensUsed: 0,
      providersUsed: [provider.name],
    };
    
    try {
      // Execute agent task as chat with structured prompts
      const systemPrompt = `You are an autonomous AI agent. Your task type is: ${task.type}
      
Objective: ${task.objective}

${task.context ? `Context: ${task.context}` : ""}

${task.constraints?.length ? `Constraints:\n${task.constraints.map((c) => `- ${c}`).join("\n")}` : ""}

Think through this step by step and provide a structured response with your reasoning and results.`;
      
      const response = await this.executeChat(provider, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: task.objective },
        ],
        maxTokens: provider.maxTokens,
        temperature: 0.5,
      });
      
      result.result = response.message.content;
      result.tokensUsed = response.usage.totalTokens;
      
    } catch (error: any) {
      result.status = "failed";
      result.error = error.message;
    }
    
    this.emitEvent("agent:task:completed", result);
    
    this.sendToClient(clientId, {
      id: uuidv4(),
      type: "agent-task",
      from: { type: "agent", id: "autonomous" },
      payload: result,
      timestamp: Date.now(),
      replyTo: message.id,
    });
  }
  
  private async handleToolCall(clientId: string, message: OpenClawMessage): Promise<void> {
    this.emitEvent("tool:invoked", message.payload);
    
    // Tool calls are forwarded to registered handlers
    this.emit("tool:call", {
      clientId,
      message,
    });
  }
  
  private async handleControlMessage(clientId: string, message: OpenClawMessage): Promise<void> {
    const { action, ...params } = message.payload as { action: string } & Record<string, unknown>;
    
    switch (action) {
      case "get-status":
        this.sendToClient(clientId, {
          id: uuidv4(),
          type: "control",
          from: { type: "system", id: "gateway" },
          payload: { action: "status", state: this.getGatewayState() },
          timestamp: Date.now(),
          replyTo: message.id,
        });
        break;
        
      case "list-providers":
        this.sendToClient(clientId, {
          id: uuidv4(),
          type: "control",
          from: { type: "system", id: "gateway" },
          payload: {
            action: "providers",
            providers: Object.entries(this.config.aiProviders).map(([id, p]) => ({
              id,
              ...p,
              apiKey: p.apiKey ? "***" : undefined,
            })),
          },
          timestamp: Date.now(),
          replyTo: message.id,
        });
        break;
        
      case "switch-provider":
        if (params.provider && typeof params.provider === "string") {
          this.config.defaultProvider = params.provider;
          await this.saveConfig();
        }
        break;
    }
  }
  
  // ===========================================================================
  // PROVIDER MANAGEMENT
  // ===========================================================================
  
  private async selectProvider(requiredCapabilities?: OpenClawCapability[]): Promise<OpenClawAIProvider | null> {
    const { mode, preferLocal, useCloudForComplex } = this.config.routing;
    
    // Get enabled providers sorted by priority, keeping their dictionary keys
    const providers = Object.entries(this.config.aiProviders)
      .filter(([, p]) => p.enabled)
      .sort(([, a], [, b]) => a.priority - b.priority);
    
    if (providers.length === 0) {
      return null;
    }
    
    // Filter by required capabilities
    let candidates = providers;
    if (requiredCapabilities?.length) {
      candidates = providers.filter(([, p]) =>
        requiredCapabilities.every((cap) => p.capabilities.includes(cap))
      );
    }
    
    if (candidates.length === 0) {
      // Fall back to any enabled provider
      candidates = providers;
    }
    
    // Smart routing
    if (mode === "smart") {
      // Check if task requires cloud capabilities
      const needsCloud = requiredCapabilities?.some((c) =>
        ["vision", "function-calling", "agentic"].includes(c)
      );
      
      if (needsCloud && useCloudForComplex) {
        // Prefer cloud providers
        const cloud = candidates.find(([, p]) => !p.capabilities.includes("local-only"));
        if (cloud) return cloud[1];
      }
      
      if (preferLocal) {
        // Prefer local providers
        const local = candidates.find(([, p]) =>
          p.type === "ollama" || p.type === "lmstudio"
        );
        if (local && await this.isProviderHealthy(local[0], local[1])) {
          return local[1];
        }
      }
    }
    
    // Return first healthy candidate
    for (const [key, provider] of candidates) {
      if (await this.isProviderHealthy(key, provider)) {
        return provider;
      }
    }
    
    return candidates[0]?.[1] ?? null; // Last resort
  }
  
  private async isProviderHealthy(key: string, provider: OpenClawAIProvider): Promise<boolean> {
    const cached = this.providerHealthCache.get(key);
    if (cached && Date.now() - cached.lastCheck < 30000) {
      return cached.healthy;
    }
    
    try {
      let healthy = false;
      
      switch (provider.type) {
        case "ollama": {
          const url = `${provider.baseURL || "http://localhost:11434"}/api/tags`;
          logger.debug(`Checking Ollama health at ${url}`);
          const response = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(5000),
          });
          healthy = response.ok;
          logger.debug(`Ollama health check: ${response.status} → ${healthy}`);
          break;
        }
        case "lmstudio": {
          const response = await fetch(`${provider.baseURL || "http://localhost:1234"}/v1/models`, {
            method: "GET",
            signal: AbortSignal.timeout(5000),
          });
          healthy = response.ok;
          break;
        }
        case "anthropic":
        case "claude-code":
        case "openai":
        case "deepseek":
        case "google":
        case "openai-compat":
          healthy = !!provider.apiKey;
          break;
        default:
          healthy = true;
      }
      
      this.providerHealthCache.set(key, { healthy, lastCheck: Date.now() });
      return healthy;
    } catch (err: any) {
      logger.warn(`Provider health check failed for ${key}: ${err.message}`);
      this.providerHealthCache.set(key, { healthy: false, lastCheck: Date.now() });
      return false;
    }
  }
  
  async checkProviderHealth(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};
    
    for (const [name, provider] of Object.entries(this.config.aiProviders)) {
      if (provider.enabled) {
        health[name] = await this.isProviderHealthy(name, provider);
      }
    }
    
    return health;
  }
  
  getProviderStatus(): Array<{ name: string; enabled: boolean; healthy: boolean; type: string; model: string; priority: number; capabilities: string[]; hasApiKey: boolean }> {
    return Object.entries(this.config.aiProviders).map(([name, p]) => ({
      name,
      enabled: p.enabled,
      healthy: this.providerHealthCache.get(name)?.healthy ?? false,
      type: p.type,
      model: p.model,
      priority: p.priority,
      capabilities: p.capabilities ?? [],
      hasApiKey: !!p.apiKey,
    }));
  }

  /**
   * Proxy an HTTP request to the external daemon.
   * Used so the control-ui SPA (served from the internal gateway on 18792)
   * can reach the daemon's API endpoints transparently.
   */
  private proxyToDaemon(req: http.IncomingMessage, res: http.ServerResponse): void {
    const daemonPort = this.config.gateway.daemonPort ?? 18790;
    const daemonHost = "127.0.0.1";

    // Handle CORS preflight without hitting the daemon
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Token",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    const proxyReq = http.request(
      {
        hostname: daemonHost,
        port: daemonPort,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${daemonHost}:${daemonPort}`,
        },
        timeout: 15_000,
      },
      (proxyRes) => {
        // Copy status and headers from daemon response
        const headers = { ...proxyRes.headers };
        // Allow CORS for the iframe
        headers["access-control-allow-origin"] = "*";
        headers["access-control-allow-methods"] = "GET, POST, PUT, DELETE, PATCH, OPTIONS";
        headers["access-control-allow-headers"] = "Content-Type, Authorization, X-Auth-Token";
        res.writeHead(proxyRes.statusCode || 502, headers);
        proxyRes.pipe(res, { end: true });
      },
    );

    proxyReq.on("error", (err) => {
      logger.debug("Proxy to daemon failed:", err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Daemon unreachable", message: err.message }));
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      res.writeHead(504, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Daemon timeout" }));
    });

    // Pipe request body to daemon
    req.pipe(proxyReq, { end: true });
  }

  private getDashboardHtml(): string {
    // Fallback HTML shown only when the real control UI assets are not found
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>OpenClaw</title></head>
<body style="font-family:system-ui;background:#0a0a0f;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1>OpenClaw Gateway</h1><p style="color:#94a3b8">Control UI assets not found.<br>Install the <code>openclaw</code> package or run <code>npx openclaw gateway run</code>.</p>
<p style="margin-top:16px"><a href="/api/status" style="color:#60a5fa">API Status</a></p></div></body></html>`;
  }

  /**
   * Resolve the directory containing the real OpenClaw control-ui static files
   * shipped inside the openclaw npm package (dist/control-ui/).
   */
  private resolveControlUiRoot(): string | null {
    const candidates = [
      // Standard npm install: node_modules/openclaw/dist/control-ui
      path.resolve(app.getAppPath(), "node_modules", "openclaw", "dist", "control-ui"),
      // Packaged app: resources/app/node_modules/openclaw/dist/control-ui
      path.resolve(app.getAppPath(), "..", "node_modules", "openclaw", "dist", "control-ui"),
    ];

    for (const dir of candidates) {
      if (nodeFs.existsSync(path.join(dir, "index.html"))) {
        return dir;
      }
    }
    return null;
  }

  private static readonly MIME_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
  };

  /**
   * Serve a file from the OpenClaw control-ui directory.
   * Returns true if the request was handled, false otherwise.
   */
  private serveControlUiFile(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const root = this.resolveControlUiRoot();
    if (!root) {
      return false;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    let pathname = url.pathname;

    // Serve index.html for the root
    if (pathname === "/" || pathname === "/dashboard") {
      pathname = "/index.html";
    }

    // Strip leading slash, normalize
    const rel = path.posix.normalize(pathname.slice(1));

    // Path traversal protection
    if (rel.startsWith("..") || rel.includes("\0")) {
      return false;
    }

    const filePath = path.join(root, rel);

    // Ensure the resolved path is inside the root
    if (!filePath.startsWith(root)) {
      return false;
    }

    if (nodeFs.existsSync(filePath) && nodeFs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = OpenClawGatewayService.MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
      res.end(nodeFs.readFileSync(filePath));
      return true;
    }

    // SPA fallback: serve index.html for unknown routes (client-side router)
    const indexPath = path.join(root, "index.html");
    if (nodeFs.existsSync(indexPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(nodeFs.readFileSync(indexPath));
      return true;
    }

    return false;
  }
  
  async configureProvider(name: string, updates: Partial<OpenClawAIProvider>): Promise<void> {
    if (!this.config.aiProviders[name]) {
      this.config.aiProviders[name] = {
        ...updates,
        name: updates.name || name,
        type: updates.type || "custom",
        model: updates.model || "",
        enabled: updates.enabled ?? true,
        priority: updates.priority ?? 10,
        capabilities: updates.capabilities || ["chat"],
      } as OpenClawAIProvider;
    } else {
      this.config.aiProviders[name] = {
        ...this.config.aiProviders[name],
        ...updates,
      };
    }
    
    await this.saveConfig();
    
    // Re-check health
    await this.isProviderHealthy(name, this.config.aiProviders[name]);
  }
  
  async removeProvider(name: string): Promise<void> {
    delete this.config.aiProviders[name];
    await this.saveConfig();
  }
  
  // ===========================================================================
  // CLAUDE CODE INTEGRATION
  // ===========================================================================
  
  async executeClaudeCodeTask(task: ClaudeCodeTask): Promise<ClaudeCodeResult> {
    if (!this.claudeCodeConfig.enabled) {
      throw new Error("Claude Code is not enabled");
    }
    
    const provider = this.config.aiProviders["claude-code"] || this.config.aiProviders.anthropic;
    if (!provider?.enabled) {
      throw new Error("No Claude/Anthropic provider configured");
    }
    
    this.emitEvent("claude-code:task:started", { taskId: task.id, task });
    
    const result: ClaudeCodeResult = {
      taskId: task.id,
      success: false,
      changes: [],
    };
    
    try {
      // Build system prompt for file operations
      const systemPrompt = `You are Claude Code, an AI assistant specialized in code operations.
Your workspace path is: ${this.claudeCodeConfig.workspacePath || "not set"}

You can perform these operations: ${this.claudeCodeConfig.allowedOperations.join(", ")}

When asked to make code changes:
1. Analyze the request
2. Provide changes in this JSON format:
{
  "changes": [
    {"type": "create|modify|delete", "path": "relative/path", "content": "new content", "diff": "unified diff if modify"}
  ],
  "explanation": "what you did and why"
}

${this.claudeCodeConfig.sandboxMode ? "SANDBOX MODE: Changes will be previewed but not applied automatically." : ""}`;
      
      const response = await this.executeChat(provider, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: task.description },
        ],
        temperature: 0.3,
        maxTokens: 4096,
      });
      
      // Parse response for structured output
      const content = response.message.content;
      try {
        const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          result.changes = parsed.changes;
          result.output = parsed.explanation;
        } else {
          result.output = content;
        }
        result.success = true;
      } catch {
        result.output = content;
        result.success = true;
      }
      
    } catch (error: any) {
      result.error = error.message;
    }
    
    this.emitEvent("claude-code:task:completed", result);
    
    return result;
  }
  
  // ===========================================================================
  // N8N INTEGRATION
  // ===========================================================================
  
  async triggerN8nWorkflow(workflowId: string, data: unknown): Promise<void> {
    this.emitEvent("n8n:workflow:triggered", { workflowId, data });
    
    // This would integrate with the n8n handlers
    // For now, emit event that n8n handlers can listen to
    this.emit("n8n:trigger", { workflowId, data });
  }
  
  // ===========================================================================
  // HELPERS
  // ===========================================================================
  
  private updateStatus(status: OpenClawGatewayStatus, error?: string): void {
    this.state.status = status;
    this.state.error = error;
    this.emit("status:changed", { status, error });
  }
  
  /**
   * Inject a message into the gateway pipeline from an external source
   * (e.g. Telegram, Discord) without a WebSocket connection.
   */
  async injectMessage(clientId: string, message: OpenClawMessage): Promise<void> {
    await this.handleMessage(clientId, message);
  }

  private sendToClient(clientId: string, message: OpenClawMessage): void {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      this.emitEvent("message:sent", { clientId, message });
    } else {
      // External client (Telegram, Discord, etc.) — emit event for handlers to pick up
      this.emit("response:external", { clientId, message });
    }
  }
  
  private sendError(ws: WebSocket, error: string, replyTo?: string): void {
    const message: OpenClawMessage = {
      id: uuidv4(),
      type: "error",
      from: { type: "system", id: "gateway" },
      payload: { error },
      timestamp: Date.now(),
      replyTo,
    };
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
  
  private emitEvent(type: OpenClawEventType, data: unknown): void {
    const event: OpenClawEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    
    this.emit("event", event);
    
    // Persist to activity log (fire-and-forget)
    this.persistActivityEvent(type, data).catch((err) =>
      logger.debug("Failed to persist activity event:", err),
    );
  }
  
  /** Map gateway event types to DB activity log entries */
  private async persistActivityEvent(type: OpenClawEventType, data: unknown): Promise<void> {
    try {
      const { getDb } = await import("@/db");
      const { openclawActivityLog } = await import("@/db/schema");
      const { v4: makeId } = await import("uuid");
      const db = getDb();
      
      const d = (data ?? {}) as Record<string, any>;
      
      // Map event type to activity event type
      const mapping: Record<string, string> = {
        "gateway:connected": "gateway_connected",
        "gateway:disconnected": "gateway_disconnected",
        "gateway:error": "system",
        "message:received": "message_received",
        "message:sent": "message_sent",
        "provider:switched": "provider_switched",
        "agent:task:started": "agent_started",
        "agent:task:completed": "agent_completed",
        "tool:invoked": "tool_invoked",
        "chat:stream": "chat_response",
      };
      
      const eventType = mapping[type];
      if (!eventType) return; // Skip unmapped event types
      
      // Extract channel message details if present
      const message = d.message as Record<string, any> | undefined;
      const channel = message?.channel || d.channel;
      const direction = type === "message:received" ? "inbound"
        : type === "message:sent" ? "outbound"
        : "internal";
      
      db.insert(openclawActivityLog)
        .values({
          id: makeId(),
          eventType: eventType as any,
          channel: channel || null,
          channelMessageId: message?.id || d.channelMessageId || null,
          actor: d.actor || d.clientId || "openclaw",
          actorDisplayName: d.actorDisplayName || d.displayName || message?.from?.displayName || null,
          content: message?.content || message?.text || d.content || d.result?.slice?.(0, 500) || null,
          contentType: "text",
          provider: d.provider || message?.provider || null,
          model: d.model || message?.model || null,
          agentId: d.agentId || null,
          taskId: d.taskId || null,
          workflowId: d.workflowId || null,
          tokensUsed: d.tokensUsed || null,
          durationMs: d.durationMs || d.latencyMs || null,
          localProcessed: d.localProcessed ?? false,
          direction: direction as any,
          metadataJson: d,
          externalEventId: d.externalEventId || null,
        })
        .run();
    } catch {
      // Silently ignore persistence failures — the event still fires
    }
  }
  
  /** Persist a channel message (from Discord/Telegram/etc.) to the DB */
  private async persistChannelMessage(message: Record<string, any>): Promise<void> {
    // Only persist actual channel messages (not heartbeats, control frames, etc.)
    const channel = message.channel || message.platform;
    if (!channel || !["discord", "telegram", "slack", "whatsapp", "webchat"].includes(channel)) {
      return;
    }
    
    try {
      const { getDb } = await import("@/db");
      const { openclawChannelMessages } = await import("@/db/schema");
      const { v4: makeId } = await import("uuid");
      const db = getDb();
      
      const msgId = message.messageId || message.id;
      
      // De-duplicate by platform message ID
      if (msgId) {
        const { eq, and } = await import("drizzle-orm");
        const existing = db
          .select({ id: openclawChannelMessages.id })
          .from(openclawChannelMessages)
          .where(
            and(
              eq(openclawChannelMessages.channel, channel),
              eq(openclawChannelMessages.channelMessageId, String(msgId)),
            ),
          )
          .get();
        if (existing) return;
      }
      
      const sender = message.author || message.from || message.sender || {};
      
      db.insert(openclawChannelMessages)
        .values({
          id: makeId(),
          channel,
          channelMessageId: msgId ? String(msgId) : null,
          channelId: message.channelId || message.chatId ? String(message.channelId || message.chatId) : null,
          channelName: message.channelName || message.chatName || null,
          senderId: String(sender.id || sender.userId || "unknown"),
          senderName: sender.displayName || sender.username || sender.name || "Unknown",
          senderAvatar: sender.avatar || sender.avatarUrl || null,
          isBot: sender.bot === true || sender.isBot === true,
          content: message.content || message.text || "",
          contentType: message.contentType || "text",
          attachmentsJson: message.attachments || null,
          replyToMessageId: message.replyTo?.id ? String(message.replyTo.id) : null,
          replyToContent: message.replyTo?.content || null,
          provider: message.provider || null,
          model: message.model || null,
          tokensUsed: message.tokensUsed || null,
          durationMs: message.durationMs || null,
          platformTimestamp: message.timestamp ? new Date(message.timestamp) : null,
        })
        .run();
    } catch {
      // Silently ignore — don't break the event flow
    }
  }
  
  getGatewayState(): OpenClawGatewayState {
    // In bridge mode, reflect the external gateway's reachability as our status
    if (this.externalGatewayAlive && this.state.status !== "connected") {
      this.state.status = "connected";
    }
    return { ...this.state, bridged: this.bridgeMode || this.externalGatewayAlive };
  }
  
  // ===========================================================================
  // PUBLIC API FOR IPC
  // ===========================================================================
  
  async chat(request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    const provider = await this.selectProvider(request.capabilities);
    if (!provider) {
      throw new Error("No suitable provider available");
    }
    
    const startTime = Date.now();
    const response = await this.executeChat(provider, request);
    response.latencyMs = Date.now() - startTime;
    response.localProcessed = provider.type === "ollama" || provider.type === "lmstudio";
    
    return response;
  }
  
  async executeAgentTask(task: OpenClawAgentTask): Promise<OpenClawAgentTaskResult> {
    const provider = task.preferLocal
      ? this.config.aiProviders.ollama
      : await this.selectProvider(["agentic", "reasoning"]);
    
    if (!provider) {
      throw new Error("No suitable provider for agent task");
    }
    
    this.emitEvent("agent:task:started", { taskId: task.id, task });
    
    const result: OpenClawAgentTaskResult = {
      taskId: task.id,
      status: "completed",
      iterations: 1,
      tokensUsed: 0,
      providersUsed: [provider.name],
    };
    
    try {
      const systemPrompt = `You are an autonomous AI agent performing a ${task.type} task.
Objective: ${task.objective}
${task.context ? `Context: ${task.context}` : ""}
${task.constraints?.length ? `Constraints: ${task.constraints.join(", ")}` : ""}`;
      
      const response = await this.executeChat(provider, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: task.objective },
        ],
        temperature: 0.5,
      });
      
      result.result = response.message.content;
      result.tokensUsed = response.usage.totalTokens;
      
    } catch (error: any) {
      result.status = "failed";
      result.error = error.message;
    }
    
    this.emitEvent("agent:task:completed", result);
    return result;
  }
}

// Singleton export
export function getOpenClawGateway(): OpenClawGatewayService {
  return OpenClawGatewayService.getInstance();
}
