import { spawn, ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import os from "node:os";
import log from "electron-log";
import { BrowserWindow } from "electron";
import { createLoggedHandler } from "./safe_handle";
import { getDyadAppPath } from "../../paths/paths";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import type { TerminalSession } from "../types/terminal";

const logger = log.scope("terminal_handlers");
const handle = createLoggedHandler(logger);

// Store active terminal sessions
interface TerminalProcess {
  process: ChildProcess;
  session: TerminalSession;
}

const terminalSessions = new Map<string, TerminalProcess>();

/**
 * Get the default shell for the current platform
 */
function getDefaultShell(): string {
  if (process.platform === "win32") {
    // Use the system default shell (typically cmd.exe via COMSPEC)
    return process.env.COMSPEC || "cmd.exe";
  }
  // On Unix-like systems, use the user's configured shell or bash
  return process.env.SHELL || "/bin/bash";
}

/**
 * Get shell-specific arguments for interactive mode
 */
function getShellArgs(shell: string): string[] {
  const shellName = shell.toLowerCase();

  if (process.platform === "win32") {
    if (shellName.includes("powershell")) {
      return ["-NoLogo", "-NoExit"];
    }
    // cmd.exe
    return [];
  }

  // Unix-like: use interactive and login shell
  if (shellName.includes("zsh") || shellName.includes("bash")) {
    return ["-i", "-l"];
  }

  return ["-i"];
}

/**
 * Send terminal output to the renderer
 */
function sendTerminalOutput(
  sessionId: string,
  data: string,
  type: "stdout" | "stderr" | "system",
): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    window.webContents.send("terminal:output", {
      sessionId,
      data,
      type,
    });
  }
}

/**
 * Notify renderer that a session has closed
 */
function sendSessionClosed(sessionId: string): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    window.webContents.send("terminal:session-closed", { sessionId });
  }
}

const MAX_CONCURRENT_SESSIONS = 10;

// Allowlist of safe environment variable keys to forward to spawned shells
const SAFE_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
  "COLORTERM",
  "EDITOR",
  "VISUAL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "COMSPEC",
  "SYSTEMROOT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "COMMONPROGRAMFILES",
]);

function getFilteredEnv(): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      (SAFE_ENV_KEYS.has(key) || key.startsWith("XDG_"))
    ) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export function registerTerminalHandlers() {
  // Create a new terminal session
  handle(
    "terminal:create-session",
    async (_event, params: { appId: number }): Promise<TerminalSession> => {
      const { appId } = params;

      // Enforce session limit
      if (terminalSessions.size >= MAX_CONCURRENT_SESSIONS) {
        throw new Error(
          `Maximum number of terminal sessions (${MAX_CONCURRENT_SESSIONS}) reached. Close an existing session first.`,
        );
      }

      // Get the app to find its path
      const [app] = await db.select().from(apps).where(eq(apps.id, appId));
      if (!app) {
        throw new Error(`App with id ${appId} not found`);
      }

      const appPath = getDyadAppPath(app.path);
      const sessionId = uuidv4();
      const shell = getDefaultShell();
      const shellArgs = getShellArgs(shell);

      logger.info(
        `Creating terminal session ${sessionId} for app ${appId} at ${appPath}`,
      );
      logger.debug(`Shell: ${shell}, Args: ${shellArgs.join(" ")}`);

      // Set up environment with filtered safe variables only
      const homeDir = process.env.HOME || os.homedir();
      const env = {
        ...getFilteredEnv(),
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        HOME: homeDir,
        ...(process.platform === "win32" && {
          USERPROFILE: process.env.USERPROFILE || homeDir,
        }),
        FORCE_COLOR: "1",
        CLICOLOR_FORCE: "1",
      };

      const terminalProcess = spawn(shell, shellArgs, {
        cwd: appPath,
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        // On Windows, we need to set windowsHide to hide the console window
        ...(process.platform === "win32" && { windowsHide: true }),
      });

      const session: TerminalSession = {
        id: sessionId,
        appId,
        cwd: appPath,
        isRunning: true,
      };

      terminalSessions.set(sessionId, {
        process: terminalProcess,
        session,
      });

      // Use StringDecoder to correctly handle multi-byte UTF-8 characters
      // split across chunks
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");

      // Handle stdout
      terminalProcess.stdout?.on("data", (data: Buffer) => {
        sendTerminalOutput(sessionId, stdoutDecoder.write(data), "stdout");
      });

      // Handle stderr
      terminalProcess.stderr?.on("data", (data: Buffer) => {
        sendTerminalOutput(sessionId, stderrDecoder.write(data), "stderr");
      });

      // Handle process exit
      terminalProcess.on("close", (code, signal) => {
        logger.info(
          `Terminal session ${sessionId} closed with code ${code}, signal ${signal}`,
        );
        const termProcess = terminalSessions.get(sessionId);
        if (termProcess) {
          termProcess.session.isRunning = false;
        }
        terminalSessions.delete(sessionId);
        sendSessionClosed(sessionId);
      });

      // Handle process errors (e.g., shell not found, permission denied)
      terminalProcess.on("error", (error) => {
        logger.error(`Terminal session ${sessionId} error:`, error);
        const termProcess = terminalSessions.get(sessionId);
        if (termProcess) {
          termProcess.session.isRunning = false;
        }
        terminalSessions.delete(sessionId);
        sendTerminalOutput(
          sessionId,
          `\r\nTerminal error: ${error.message}\r\n`,
          "system",
        );
        sendSessionClosed(sessionId);
      });

      // Send initial welcome message
      sendTerminalOutput(
        sessionId,
        `\x1b[2m# Terminal started in ${appPath}\x1b[0m\r\n`,
        "system",
      );

      return session;
    },
  );

  // Write data to a terminal session
  handle(
    "terminal:write",
    async (
      _event,
      params: { sessionId: string; data: string },
    ): Promise<void> => {
      const { sessionId, data } = params;
      const termProcess = terminalSessions.get(sessionId);

      if (!termProcess) {
        throw new Error(`Terminal session ${sessionId} not found`);
      }

      if (!termProcess.session.isRunning) {
        throw new Error(`Terminal session ${sessionId} is not running`);
      }

      if (!termProcess.process.stdin) {
        throw new Error(`Terminal session ${sessionId} has no stdin`);
      }
      termProcess.process.stdin.write(data);
    },
  );

  // Resize terminal (placeholder for future PTY support)
  handle(
    "terminal:resize",
    async (
      _event,
      params: { sessionId: string; cols: number; rows: number },
    ): Promise<void> => {
      const { sessionId, cols, rows } = params;
      const termProcess = terminalSessions.get(sessionId);

      if (!termProcess) {
        throw new Error(`Terminal session ${sessionId} not found`);
      }

      // Note: Resize is not functional without PTY support (node-pty).
      // Logging at warn level so callers are aware this is a no-op.
      logger.warn(
        `Terminal resize is a no-op without PTY support (session ${sessionId}: ${cols}x${rows})`,
      );
    },
  );

  // Close a terminal session
  handle(
    "terminal:close",
    async (_event, params: { sessionId: string }): Promise<void> => {
      const { sessionId } = params;
      const termProcess = terminalSessions.get(sessionId);

      if (!termProcess) {
        // Session already closed, that's fine
        return;
      }

      logger.info(`Closing terminal session ${sessionId}`);

      // Mark session as not running so the close event handler
      // and SIGKILL timeout can check this correctly
      termProcess.session.isRunning = false;

      // Kill the process - let the 'close' event handler clean up the map entry
      if (termProcess.process.pid) {
        try {
          // Send SIGTERM first for graceful shutdown
          termProcess.process.kill("SIGTERM");

          // Force kill after timeout if process hasn't exited
          setTimeout(() => {
            try {
              if (terminalSessions.has(sessionId)) {
                termProcess.process.kill("SIGKILL");
              }
            } catch {
              // Process may have already exited
            }
          }, 1000);
        } catch (error) {
          logger.warn(`Error killing terminal process:`, error);
        }
      }
    },
  );

  // Get session info
  handle(
    "terminal:get-session",
    async (
      _event,
      params: { sessionId: string },
    ): Promise<TerminalSession | null> => {
      const { sessionId } = params;
      const termProcess = terminalSessions.get(sessionId);

      if (!termProcess) {
        return null;
      }

      return termProcess.session;
    },
  );
}

/**
 * Clean up all terminal sessions (called on app quit)
 */
export function cleanupTerminalSessions(): void {
  logger.info(`Cleaning up ${terminalSessions.size} terminal sessions`);

  for (const [sessionId, termProcess] of terminalSessions) {
    try {
      if (termProcess.process.pid) {
        termProcess.process.kill("SIGTERM");
      }
    } catch (error) {
      logger.warn(`Error cleaning up terminal session ${sessionId}:`, error);
    }
  }

  terminalSessions.clear();
}
