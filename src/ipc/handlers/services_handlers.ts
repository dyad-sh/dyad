/**
 * External Services Handler
 * 
 * IPC handlers for managing external services like n8n and Celestia node.
 * Provides start/stop/status functionality for each service.
 * Services are launched in external terminal windows for visibility.
 */

import { ipcMain, IpcMainInvokeEvent, shell } from "electron";
import { spawn, ChildProcess, exec, execSync } from "child_process";
import path from "node:path";
import fs from "fs-extra";
import log from "electron-log";
import { app } from "electron";

const logger = log.scope("services_handlers");

// =============================================================================
// PATH HELPERS
// =============================================================================

function getUserDataPath(): string {
  // Use JoyCreate's userData folder for consistent data storage
  if (app.isPackaged) {
    return app.getPath("userData");
  }
  // In development, use the local userData folder
  return path.join(process.cwd(), "userData");
}

// =============================================================================
// SERVICE TYPES
// =============================================================================

export type ServiceId = "n8n" | "celestia" | "ollama";

export interface ServiceStatus {
  id: ServiceId;
  name: string;
  running: boolean;
  pid?: number;
  startedAt?: number;
  port?: number;
  error?: string;
}

export interface ServiceConfig {
  id: ServiceId;
  name: string;
  description: string;
  port?: number;
  scriptPath?: string;
  dockerCompose?: string;
  useWSL?: boolean;
  healthCheckUrl?: string;
}

// =============================================================================
// SERVICE CONFIGURATIONS
// =============================================================================

const SERVICE_CONFIGS: Record<ServiceId, ServiceConfig> = {
  n8n: {
    id: "n8n",
    name: "n8n Workflow Automation",
    description: "Visual workflow automation platform for AI agents",
    port: 5678,
    healthCheckUrl: "http://localhost:5678/healthz",
  },
  celestia: {
    id: "celestia",
    name: "Celestia Light Node",
    description: "Data availability layer for decentralized storage",
    port: 26658,
    useWSL: true,
    healthCheckUrl: "http://localhost:26658/health",
  },
  ollama: {
    id: "ollama",
    name: "Ollama Local AI",
    description: "Local LLM inference server",
    port: 11434,
    healthCheckUrl: "http://localhost:11434/api/tags",
  },
};

// Track service start times for uptime display
const serviceStartTimes: Map<ServiceId, number> = new Map();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getAppBasePath(): string {
  // In development, use current working directory
  // In production, use the app's resource path
  if (app.isPackaged) {
    return path.dirname(app.getPath("exe"));
  }
  return process.cwd();
}

async function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const command = process.platform === "win32"
      ? `netstat -ano | findstr :${port}`
      : `lsof -i :${port}`;
    
    exec(command, (error, stdout) => {
      resolve(!!stdout && stdout.trim().length > 0);
    });
  });
}

async function checkServiceHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(url, { 
      signal: controller.signal,
      method: "GET",
    });
    
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function checkWSLCelestiaRunning(): Promise<{ running: boolean; pid?: number }> {
  return new Promise((resolve) => {
    exec('wsl pgrep -f "celestia light"', (error, stdout) => {
      if (stdout && stdout.trim()) {
        resolve({ running: true, pid: parseInt(stdout.trim().split("\n")[0]) });
      } else {
        resolve({ running: false });
      }
    });
  });
}

async function checkDockerCelestiaRunning(): Promise<{ running: boolean; containerId?: string }> {
  return new Promise((resolve) => {
    exec('docker ps --filter "name=celestia-mainnet-node" --format "{{.ID}}"', (error, stdout) => {
      if (stdout && stdout.trim()) {
        resolve({ running: true, containerId: stdout.trim() });
      } else {
        resolve({ running: false });
      }
    });
  });
}

// =============================================================================
// HELPER: Launch in External Terminal
// =============================================================================

/**
 * Launch a command in an external terminal window (Windows)
 */
function launchInExternalTerminal(
  title: string,
  command: string,
  cwd?: string
): ChildProcess {
  // Use Windows Terminal if available, otherwise fall back to cmd
  // wt.exe = Windows Terminal, cmd.exe = Command Prompt
  const workingDir = cwd || getAppBasePath();
  
  // Try Windows Terminal first, with fallback to cmd
  const wtCommand = `start "JoyCreate - ${title}" cmd /k "cd /d "${workingDir}" && ${command}"`;
  
  logger.info(`Launching in external terminal: ${title}`);
  logger.info(`Command: ${command}`);
  logger.info(`Working dir: ${workingDir}`);
  
  const proc = spawn(wtCommand, [], {
    shell: true,
    detached: true,
    cwd: workingDir,
    stdio: "ignore",
  });
  
  proc.unref(); // Don't wait for the terminal to close
  
  return proc;
}

/**
 * Launch a PowerShell script in an external terminal window
 */
function launchPowerShellScript(
  title: string,
  scriptPath: string,
  cwd?: string
): ChildProcess {
  const workingDir = cwd || getAppBasePath();
  
  // Open PowerShell in a new window with the script
  const command = `start "JoyCreate - ${title}" powershell -NoExit -ExecutionPolicy Bypass -File "${scriptPath}"`;
  
  logger.info(`Launching PowerShell script: ${title}`);
  logger.info(`Script: ${scriptPath}`);
  
  const proc = spawn(command, [], {
    shell: true,
    detached: true,
    cwd: workingDir,
    stdio: "ignore",
  });
  
  proc.unref();
  
  return proc;
}

// =============================================================================
// SERVICE MANAGEMENT FUNCTIONS
// =============================================================================

async function startN8nService(): Promise<ServiceStatus> {
  const config = SERVICE_CONFIGS.n8n;
  
  // Check if port is in use (maybe started externally)
  const portInUse = await checkPortInUse(config.port!);
  if (portInUse) {
    const isHealthy = await checkServiceHealth(config.healthCheckUrl!);
    if (isHealthy) {
      logger.info("n8n already running");
      return {
        id: "n8n",
        name: config.name,
        running: true,
        port: config.port,
      };
    }
  }
  
  logger.info("Starting n8n service with local PostgreSQL...");
  
  try {
    // n8n connects to the local PostgreSQL database (same as JoyCreate will use)
    // Database credentials are configured via environment variables
    // User needs to set POSTGRES_PASSWORD environment variable or use .env file
    const n8nCommand = [
      `echo Starting n8n with PostgreSQL on port ${config.port}...`,
      `echo Note: Set POSTGRES_PASSWORD env var if not using default`,
      `set "DB_TYPE=postgresdb"`,
      `set "DB_POSTGRESDB_HOST=localhost"`,
      `set "DB_POSTGRESDB_PORT=5432"`,
      `set "DB_POSTGRESDB_DATABASE=joycreate"`,
      `set "DB_POSTGRESDB_USER=postgres"`,
      `set "DB_POSTGRESDB_SCHEMA=n8n"`,
      `set "N8N_PORT=${config.port}"`,
      `set "N8N_SECURE_COOKIE=false"`,
      `npx n8n start`
    ].join(" && ");
    
    launchInExternalTerminal("n8n Workflow Automation", n8nCommand);
    
    serviceStartTimes.set("n8n", Date.now());
    
    // Wait for n8n to be ready
    logger.info("Waiting for n8n to start...");
    let attempts = 0;
    while (attempts < 45) {
      await new Promise((r) => setTimeout(r, 2000));
      const isHealthy = await checkServiceHealth(config.healthCheckUrl!);
      if (isHealthy) {
        logger.info("n8n started successfully with PostgreSQL");
        return {
          id: "n8n",
          name: config.name,
          running: true,
          startedAt: serviceStartTimes.get("n8n"),
          port: config.port,
        };
      }
      attempts++;
    }
    
    // Even if health check times out, the service might still be starting
    return {
      id: "n8n",
      name: config.name,
      running: false,
      port: config.port,
      error: "Service starting... check the terminal window",
    };
  } catch (error) {
    logger.error("Failed to start n8n:", error);
    return {
      id: "n8n",
      name: config.name,
      running: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function stopN8nService(): Promise<ServiceStatus> {
  const config = SERVICE_CONFIGS.n8n;
  
  logger.info("Stopping n8n service...");
  
  // Stop Docker container
  try {
    execSync('docker stop joycreate-n8n', { stdio: "ignore" });
    logger.info("Stopped n8n Docker container");
  } catch {
    // Container might not exist or already stopped
  }
  
  // Also try to kill any local n8n processes (in case it was started manually)
  try {
    execSync('taskkill /IM "node.exe" /FI "WINDOWTITLE eq JoyCreate - n8n*" /F', { stdio: "ignore" });
  } catch {
    // Process might not exist
  }
  
  // Also try to kill by port
  try {
    const result = execSync(`netstat -ano | findstr :${config.port}`, { encoding: "utf8" });
    const lines = result.trim().split("\n");
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(parseInt(pid))) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
        } catch {
          // Ignore errors
        }
      }
    }
  } catch {
    // No process on port
  }
  
  serviceStartTimes.delete("n8n");
  
  return {
    id: "n8n",
    name: config.name,
    running: false,
  };
}

async function startCelestiaService(): Promise<ServiceStatus> {
  const config = SERVICE_CONFIGS.celestia;
  
  // 1. Check if already running via Docker
  const dockerStatus = await checkDockerCelestiaRunning();
  if (dockerStatus.running) {
    logger.info("Celestia already running in Docker");
    return {
      id: "celestia",
      name: config.name,
      running: true,
      port: config.port,
    };
  }
  
  // 2. Check if already running in WSL
  const wslStatus = await checkWSLCelestiaRunning();
  if (wslStatus.running) {
    logger.info("Celestia already running in WSL");
    return {
      id: "celestia",
      name: config.name,
      running: true,
      pid: wslStatus.pid,
      port: config.port,
    };
  }
  
  // 3. Try Docker first (preferred — no WSL dependency)
  const composePath = path.join(getAppBasePath(), "docker-compose.celestia.yml");
  if (await fs.pathExists(composePath)) {
    logger.info("Starting Celestia light node via Docker Compose...");
    try {
      execSync(
        `docker compose -f "${composePath}" up -d`,
        { cwd: getAppBasePath(), stdio: "pipe", timeout: 60_000 },
      );
      serviceStartTimes.set("celestia", Date.now());
      
      // Wait for the container to become healthy
      logger.info("Waiting for Celestia Docker container to start...");
      let attempts = 0;
      while (attempts < 30) {
        await new Promise((r) => setTimeout(r, 3000));
        const isHealthy = await checkServiceHealth(config.healthCheckUrl!);
        if (isHealthy) {
          logger.info("Celestia Docker container started and healthy");
          return {
            id: "celestia",
            name: config.name,
            running: true,
            startedAt: serviceStartTimes.get("celestia"),
            port: config.port,
          };
        }
        // Also check if container is at least running
        const dStatus = await checkDockerCelestiaRunning();
        if (!dStatus.running && attempts > 5) {
          logger.warn("Docker container stopped unexpectedly, falling back to WSL");
          break;
        }
        attempts++;
      }
      
      // Container is running but health check hasn't passed yet
      const dStatus = await checkDockerCelestiaRunning();
      if (dStatus.running) {
        return {
          id: "celestia",
          name: config.name,
          running: true,
          startedAt: serviceStartTimes.get("celestia"),
          port: config.port,
        };
      }
    } catch (error) {
      logger.warn("Docker Compose start failed, falling back to WSL:", error);
    }
  }
  
  // 4. Fallback: WSL / PowerShell script
  logger.info("Starting Celestia light node via WSL/PowerShell fallback...");
  
  try {
    const scriptPath = path.join(getAppBasePath(), "start-celestia-node.ps1");
    
    if (await fs.pathExists(scriptPath)) {
      launchPowerShellScript("Celestia Light Node", scriptPath);
    } else {
      const celestiaCommand = `wsl bash -c "celestia light start --core.ip consensus.lunaroasis.net --p2p.network celestia --rpc.addr 0.0.0.0 --rpc.port 26658"`;
      launchInExternalTerminal("Celestia Light Node", celestiaCommand);
    }
    
    serviceStartTimes.set("celestia", Date.now());
    
    logger.info("Waiting for Celestia to start...");
    await new Promise((r) => setTimeout(r, 8000));
    
    const finalStatus = await checkWSLCelestiaRunning();
    return {
      id: "celestia",
      name: config.name,
      running: finalStatus.running,
      pid: finalStatus.pid,
      startedAt: serviceStartTimes.get("celestia"),
      port: config.port,
    };
  } catch (error) {
    logger.error("Failed to start Celestia:", error);
    return {
      id: "celestia",
      name: config.name,
      running: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function stopCelestiaService(): Promise<ServiceStatus> {
  const config = SERVICE_CONFIGS.celestia;
  
  logger.info("Stopping Celestia light node...");
  
  // Stop Docker container if running
  try {
    const composePath = path.join(getAppBasePath(), "docker-compose.celestia.yml");
    if (await fs.pathExists(composePath)) {
      execSync(
        `docker compose -f "${composePath}" down`,
        { cwd: getAppBasePath(), stdio: "pipe", timeout: 30_000 },
      );
      logger.info("Stopped Celestia Docker container");
    }
  } catch {
    // Try direct container stop
    try {
      execSync('docker stop celestia-mainnet-node', { stdio: "ignore" });
    } catch {
      // Container might not exist
    }
  }
  
  // Also stop WSL process if running
  return new Promise((resolve) => {
    exec('wsl pkill -f "celestia light"', async () => {
      // Also kill tmux session
      exec('wsl bash -c "tmux kill-session -t celestia 2>/dev/null"', async () => {
        serviceStartTimes.delete("celestia");
        
        await new Promise((r) => setTimeout(r, 1000));
        const wslStatus = await checkWSLCelestiaRunning();
        const dockerStatus = await checkDockerCelestiaRunning();
        
        resolve({
          id: "celestia",
          name: config.name,
          running: wslStatus.running || dockerStatus.running,
        });
      });
    });
  });
}

async function startOllamaService(): Promise<ServiceStatus> {
  const config = SERVICE_CONFIGS.ollama;
  
  // Check if already running
  const isHealthy = await checkServiceHealth(config.healthCheckUrl!);
  if (isHealthy) {
    logger.info("Ollama already running");
    return {
      id: "ollama",
      name: config.name,
      running: true,
      port: config.port,
    };
  }
  
  logger.info("Starting Ollama service in external terminal...");
  
  try {
    launchInExternalTerminal("Ollama Local AI", "ollama serve");
    
    serviceStartTimes.set("ollama", Date.now());
    
    // Wait for Ollama to be ready
    logger.info("Waiting for Ollama to start...");
    let attempts = 0;
    while (attempts < 20) {
      await new Promise((r) => setTimeout(r, 1000));
      const healthy = await checkServiceHealth(config.healthCheckUrl!);
      if (healthy) {
        logger.info("Ollama started successfully");
        return {
          id: "ollama",
          name: config.name,
          running: true,
          startedAt: serviceStartTimes.get("ollama"),
          port: config.port,
        };
      }
      attempts++;
    }
    
    return {
      id: "ollama",
      name: config.name,
      running: false,
      port: config.port,
      error: "Service starting... check the terminal window",
    };
  } catch (error) {
    logger.error("Failed to start Ollama:", error);
    return {
      id: "ollama",
      name: config.name,
      running: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function stopOllamaService(): Promise<ServiceStatus> {
  const config = SERVICE_CONFIGS.ollama;
  
  logger.info("Stopping Ollama service...");
  
  // Kill Ollama process on Windows
  try {
    execSync('taskkill /IM "ollama.exe" /F', { stdio: "ignore" });
  } catch {
    // Process might not exist
  }
  
  // Close the terminal window
  try {
    execSync('taskkill /FI "WINDOWTITLE eq JoyCreate - Ollama*" /F', { stdio: "ignore" });
  } catch {
    // Window might not exist
  }
  
  serviceStartTimes.delete("ollama");
  
  return {
    id: "ollama",
    name: config.name,
    running: false,
  };
}

async function getServiceStatus(serviceId: ServiceId): Promise<ServiceStatus> {
  const config = SERVICE_CONFIGS[serviceId];
  
  switch (serviceId) {
    case "n8n": {
      const isHealthy = config.healthCheckUrl 
        ? await checkServiceHealth(config.healthCheckUrl)
        : false;
      return {
        id: "n8n",
        name: config.name,
        running: isHealthy,
        startedAt: serviceStartTimes.get("n8n"),
        port: config.port,
      };
    }
    
    case "celestia": {
      // Check Docker first, then WSL, then health endpoint
      const dockerStatus = await checkDockerCelestiaRunning();
      const wslStatus = await checkWSLCelestiaRunning();
      const isHealthy = config.healthCheckUrl
        ? await checkServiceHealth(config.healthCheckUrl)
        : false;
      const running = dockerStatus.running || wslStatus.running || isHealthy;
      return {
        id: "celestia",
        name: config.name,
        running,
        pid: wslStatus.pid,
        startedAt: serviceStartTimes.get("celestia"),
        port: config.port,
      };
    }
    
    case "ollama": {
      const isHealthy = config.healthCheckUrl
        ? await checkServiceHealth(config.healthCheckUrl)
        : false;
      return {
        id: "ollama",
        name: config.name,
        running: isHealthy,
        startedAt: serviceStartTimes.get("ollama"),
        port: config.port,
      };
    }
    
    default:
      return {
        id: serviceId,
        name: "Unknown",
        running: false,
        error: "Unknown service",
      };
  }
}

async function getAllServicesStatus(): Promise<ServiceStatus[]> {
  const statuses = await Promise.all([
    getServiceStatus("n8n"),
    getServiceStatus("celestia"),
    getServiceStatus("ollama"),
  ]);
  return statuses;
}

// =============================================================================
// IPC HANDLER REGISTRATION
// =============================================================================

export function registerServicesHandlers(): void {
  logger.info("Registering external services handlers...");

  // Get all services configuration
  ipcMain.handle("services:list", async () => {
    return Object.values(SERVICE_CONFIGS);
  });

  // Get status of all services
  ipcMain.handle("services:status:all", async () => {
    return getAllServicesStatus();
  });

  // Get status of a specific service
  ipcMain.handle(
    "services:status",
    async (_event: IpcMainInvokeEvent, serviceId: ServiceId) => {
      return getServiceStatus(serviceId);
    }
  );

  // Start a service
  ipcMain.handle(
    "services:start",
    async (_event: IpcMainInvokeEvent, serviceId: ServiceId) => {
      logger.info(`Starting service: ${serviceId}`);
      
      switch (serviceId) {
        case "n8n":
          return startN8nService();
        case "celestia":
          return startCelestiaService();
        case "ollama":
          return startOllamaService();
        default:
          throw new Error(`Unknown service: ${serviceId}`);
      }
    }
  );

  // Stop a service
  ipcMain.handle(
    "services:stop",
    async (_event: IpcMainInvokeEvent, serviceId: ServiceId) => {
      logger.info(`Stopping service: ${serviceId}`);
      
      switch (serviceId) {
        case "n8n":
          return stopN8nService();
        case "celestia":
          return stopCelestiaService();
        case "ollama":
          return stopOllamaService();
        default:
          throw new Error(`Unknown service: ${serviceId}`);
      }
    }
  );

  // Restart a service
  ipcMain.handle(
    "services:restart",
    async (_event: IpcMainInvokeEvent, serviceId: ServiceId) => {
      logger.info(`Restarting service: ${serviceId}`);
      
      switch (serviceId) {
        case "n8n":
          await stopN8nService();
          await new Promise((r) => setTimeout(r, 2000));
          return startN8nService();
        case "celestia":
          await stopCelestiaService();
          await new Promise((r) => setTimeout(r, 2000));
          return startCelestiaService();
        case "ollama":
          await stopOllamaService();
          await new Promise((r) => setTimeout(r, 2000));
          return startOllamaService();
        default:
          throw new Error(`Unknown service: ${serviceId}`);
      }
    }
  );

  // Start all services
  ipcMain.handle("services:start:all", async () => {
    logger.info("Starting all services...");
    const results = await Promise.all([
      startN8nService(),
      startCelestiaService(),
      startOllamaService(),
    ]);
    return results;
  });

  // Stop all services
  ipcMain.handle("services:stop:all", async () => {
    logger.info("Stopping all services...");
    const results = await Promise.all([
      stopN8nService(),
      stopCelestiaService(),
      stopOllamaService(),
    ]);
    return results;
  });

  logger.info("External services handlers registered");
}

/** Start all backend services (n8n, Celestia, Ollama). Best-effort, non-throwing. */
export async function startAllServices(): Promise<ServiceStatus[]> {
  logger.info("Auto-starting all backend services...");
  return Promise.all([
    startN8nService().catch((e) => ({ id: "n8n" as const, name: "n8n", running: false, error: String(e) })),
    startCelestiaService().catch((e) => ({ id: "celestia" as const, name: "Celestia", running: false, error: String(e) })),
    startOllamaService().catch((e) => ({ id: "ollama" as const, name: "Ollama", running: false, error: String(e) })),
  ]);
}

export default registerServicesHandlers;
