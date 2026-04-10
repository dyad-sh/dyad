/**
 * Joy Assistant System Tools
 *
 * Executes system-level operations requested by the assistant:
 * - Shell commands (with user approval)
 * - File read/write/list
 * - App launching
 * - System info queries
 *
 * All destructive operations require explicit approval from the renderer.
 */

import { exec, execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { shell } from "electron";
import log from "electron-log";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const logger = log.scope("joy-assistant-tools");

// ============================================================================
// Shell Commands
// ============================================================================

const BLOCKED_COMMANDS = [
  /\brm\s+-rf\s+[\/\\]/i,
  /\bformat\b/i,
  /\bdel\s+\/s\b/i,
  /\brd\s+\/s\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b:\(\)\s*\{/,                    // fork bomb
  /\b>\/dev\/sd[a-z]/i,
  /\breg\s+delete\b/i,
];

export function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      return { safe: false, reason: `Command matches dangerous pattern: ${pattern.source}` };
    }
  }
  return { safe: true };
}

export async function runCommand(
  command: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const safety = isCommandSafe(command);
  if (!safety.safe) {
    throw new Error(`Blocked dangerous command: ${safety.reason}`);
  }

  const workDir = cwd || os.homedir();
  if (!fs.existsSync(workDir)) {
    throw new Error(`Working directory does not exist: ${workDir}`);
  }

  logger.info("Executing command", { command: command.slice(0, 200), cwd: workDir });

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,         // 1MB
      shell: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
    });
    return { stdout: stdout.slice(0, 50_000), stderr: stderr.slice(0, 10_000), exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: (err.stdout || "").slice(0, 50_000),
      stderr: (err.stderr || err.message || "").slice(0, 10_000),
      exitCode: err.code ?? 1,
    };
  }
}

// ============================================================================
// File Operations
// ============================================================================

export async function readFileContent(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${resolved}`);
  }
  if (stat.size > 2 * 1024 * 1024) {
    throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 2MB.`);
  }

  return fs.readFileSync(resolved, "utf-8");
}

export async function writeFileContent(
  filePath: string,
  content: string,
): Promise<void> {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(resolved, content, "utf-8");
  logger.info("Wrote file", { path: resolved, size: content.length });
}

export async function listDirectory(
  dirPath: string,
): Promise<Array<{ name: string; type: "file" | "directory"; size: number }>> {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`);
  }

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  return entries.slice(0, 200).map((entry) => {
    let size = 0;
    try {
      if (entry.isFile()) {
        size = fs.statSync(path.join(resolved, entry.name)).size;
      }
    } catch { /* ignore */ }

    return {
      name: entry.name,
      type: entry.isDirectory() ? "directory" as const : "file" as const,
      size,
    };
  });
}

// ============================================================================
// App Launching
// ============================================================================

export async function openApp(appName: string, args?: string[]): Promise<void> {
  logger.info("Opening app", { appName, args });

  if (process.platform === "win32") {
    // On Windows, use shell.openPath for known executables or Start-Process
    const suffixes = [".exe", ".bat", ".cmd", ".msc", ".cpl"];
    const hasExt = suffixes.some((s) => appName.toLowerCase().endsWith(s));

    if (hasExt || path.isAbsolute(appName)) {
      if (args?.length) {
        execFile(appName, args, { shell: true }, (err) => {
          if (err) logger.warn("Failed to open app", { appName, error: err.message });
        });
      } else {
        await shell.openPath(appName);
      }
    } else {
      // Try Start-Process for application names like "notepad", "calc", etc.
      const cmd = args?.length
        ? `Start-Process "${appName}" -ArgumentList ${args.map((a) => `"${a}"`).join(",")}`
        : `Start-Process "${appName}"`;
      await execAsync(cmd, { shell: "powershell.exe" });
    }
  } else {
    // macOS / Linux
    const cmd = process.platform === "darwin" ? "open" : "xdg-open";
    await execAsync(`${cmd} "${appName}" ${(args || []).map((a) => `"${a}"`).join(" ")}`);
  }
}

export async function openUrl(url: string): Promise<void> {
  // Basic validation
  try {
    const parsed = new URL(url);
    if (!["http:", "https:", "file:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
    }
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  await shell.openExternal(url);
}

// ============================================================================
// System Info
// ============================================================================

export async function getSystemInfo(
  infoType: "os" | "hardware" | "processes" | "disk" | "memory" | "network",
): Promise<string> {
  switch (infoType) {
    case "os":
      return JSON.stringify({
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
        homeDir: os.homedir(),
        tmpDir: os.tmpdir(),
        userInfo: { username: os.userInfo().username },
      }, null, 2);

    case "hardware":
      return JSON.stringify({
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || "unknown",
        totalMemory: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
        freeMemory: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
        arch: os.arch(),
      }, null, 2);

    case "memory":
      return JSON.stringify({
        total: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
        free: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(1)} GB`,
        used: `${((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(1)} GB`,
        usagePercent: `${((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)}%`,
      }, null, 2);

    case "processes": {
      const cmd = process.platform === "win32"
        ? 'Get-Process | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 15 Name, Id, @{N="MemMB";E={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json'
        : "ps aux --sort=-%mem | head -16";
      const result = await runCommand(cmd);
      return result.stdout || result.stderr;
    }

    case "disk": {
      const cmd = process.platform === "win32"
        ? "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='UsedGB';E={[math]::Round($_.Used/1GB,1)}}, @{N='FreeGB';E={[math]::Round($_.Free/1GB,1)}} | ConvertTo-Json"
        : "df -h";
      const result = await runCommand(cmd);
      return result.stdout || result.stderr;
    }

    case "network": {
      const ifaces = os.networkInterfaces();
      const result: Record<string, string[]> = {};
      for (const [name, addrs] of Object.entries(ifaces)) {
        if (addrs) {
          result[name] = addrs.map((a) => `${a.family} ${a.address}`);
        }
      }
      return JSON.stringify(result, null, 2);
    }

    default:
      throw new Error(`Unknown info type: ${infoType}`);
  }
}
