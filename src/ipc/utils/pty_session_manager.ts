import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { spawn as defaultSpawnPty } from "node-pty";
import type { WebContents } from "electron";
import log from "electron-log";
import { shellEnvSync } from "shell-env";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { safeSend } from "./safe_sender";
import { terminatePtyProcess, type PtyProcessLike } from "./pty_command_runner";

const logger = log.scope("pty_session_manager");

const MAX_LIVE_SESSIONS = 5;
const OUTPUT_FLUSH_DELAY_MS = 8;
const MAX_SCROLLBACK_BYTES = 2 * 1024 * 1024;
const MAX_SCROLLBACK_LINES = 10_000;
const EXITED_SESSION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export interface TerminalPtyProcess extends PtyProcessLike {
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

export type TerminalPtySpawner = (
  file: string,
  args: string[],
  options: {
    cols: number;
    rows: number;
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: "utf8";
    name: string;
  },
) => TerminalPtyProcess;

interface ResolvedTerminalApp {
  id: number;
  name: string;
  cwd: string;
}

export interface TerminalSessionManagerDeps {
  resolveApp(appId: number): Promise<ResolvedTerminalApp | null>;
  pathExists(path: string): boolean | Promise<boolean>;
  ptySpawner: TerminalPtySpawner;
  getShellEnv(): Record<string, string | undefined>;
  send(
    sender: WebContents | null | undefined,
    channel: string,
    payload: unknown,
  ): void;
  now(): number;
}

interface TerminalExit {
  exitCode: number | null;
  signal?: number | null;
}

interface TerminalSubscriber {
  webContents: WebContents;
  nextOutputOffset: number;
  attachmentCount: number;
}

interface PtySession {
  appId: number;
  appName: string;
  sessionId: string;
  shell: string;
  args: string[];
  cwd: string;
  pty: TerminalPtyProcess | null;
  dataSubscription: { dispose(): void };
  exitSubscription: { dispose(): void };
  subscribers: Map<number, TerminalSubscriber>;
  scrollback: string;
  pendingOutput: string;
  pendingOutputStartOffset: number;
  outputEndOffset: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  exitReapTimer: ReturnType<typeof setTimeout> | null;
  lastUsedAt: number;
  exitedAt?: number;
  exited?: TerminalExit;
}

export interface OpenTerminalSessionParams {
  appId: number;
  cols?: number;
  rows?: number;
  sender?: WebContents;
}

export interface OpenTerminalSessionResult {
  sessionId: string;
  shell: string;
  cwd: string;
  appName: string;
  scrollback: string;
  created: boolean;
  exited?: TerminalExit;
  evicted?: {
    appId: number;
    appName: string;
  };
}

export interface SerializedTerminalSession {
  scrollback: string;
  scrollbackEndOffset: number;
}

function buildTerminalDataChannel(sessionId: string): string {
  return `terminal:data:${sessionId}`;
}

function buildTerminalExitChannel(sessionId: string): string {
  return `terminal:exit:${sessionId}`;
}

export function getDefaultShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { shell: string; args: string[] } {
  if (platform === "win32") {
    return { shell: env.COMSPEC || "cmd.exe", args: [] };
  }

  if (env.SHELL) {
    return { shell: env.SHELL, args: ["-l"] };
  }

  return {
    shell: fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash",
    args: ["-l"],
  };
}

function trimScrollback(value: string): string {
  let next = value;
  if (Buffer.byteLength(next, "utf8") > MAX_SCROLLBACK_BYTES) {
    let low = 0;
    let high = next.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (Buffer.byteLength(next.slice(mid), "utf8") > MAX_SCROLLBACK_BYTES) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    if (low < next.length) {
      const codeUnit = next.charCodeAt(low);
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        low += 1;
      }
    }
    next = next.slice(low);
  }

  const lines = next.split(/\r?\n/);
  if (lines.length > MAX_SCROLLBACK_LINES) {
    next = lines.slice(-MAX_SCROLLBACK_LINES).join("\n");
  }
  return next;
}

async function defaultResolveApp(
  appId: number,
): Promise<ResolvedTerminalApp | null> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
    columns: {
      id: true,
      name: true,
      path: true,
    },
  });

  if (!app) {
    return null;
  }

  return {
    id: app.id,
    name: app.name,
    cwd: getDyadAppPath(app.path),
  };
}

function defaultGetShellEnv(): Record<string, string | undefined> {
  try {
    return shellEnvSync();
  } catch (error) {
    logger.warn("Failed to read shell environment:", error);
    return {};
  }
}

export class PtySessionManager {
  private readonly sessions = new Map<number, PtySession>();

  constructor(private readonly deps: TerminalSessionManagerDeps) {}

  async openSession(
    params: OpenTerminalSessionParams,
  ): Promise<OpenTerminalSessionResult> {
    const existingSession = this.sessions.get(params.appId);
    if (existingSession) {
      this.attach(params.sender, existingSession);
      existingSession.lastUsedAt = this.deps.now();
      return {
        sessionId: existingSession.sessionId,
        shell: existingSession.shell,
        cwd: existingSession.cwd,
        appName: existingSession.appName,
        scrollback: existingSession.scrollback,
        created: false,
        exited: existingSession.exited,
      };
    }

    const terminalApp = await this.deps.resolveApp(params.appId);
    if (!terminalApp) {
      throw new DyadError("App not found", DyadErrorKind.NotFound);
    }

    const cwdExists = await this.deps.pathExists(terminalApp.cwd);
    if (!cwdExists) {
      throw new DyadError(
        `App folder no longer exists at ${terminalApp.cwd}`,
        DyadErrorKind.Precondition,
      );
    }

    const evicted = this.evictLeastRecentlyUsedSession();
    const shellEnv = this.deps.getShellEnv();
    const shellConfig = getDefaultShell(process.platform, {
      ...shellEnv,
      ...process.env,
    });
    const sessionId = randomUUID();
    const env = {
      ...process.env,
      ...shellEnv,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };

    const pty = this.deps.ptySpawner(shellConfig.shell, shellConfig.args, {
      cols: params.cols ?? DEFAULT_COLS,
      rows: params.rows ?? DEFAULT_ROWS,
      cwd: terminalApp.cwd,
      env,
      encoding: "utf8",
      name: "xterm-256color",
    });

    const session: PtySession = {
      appId: terminalApp.id,
      appName: terminalApp.name,
      sessionId,
      shell: shellConfig.shell,
      args: shellConfig.args,
      cwd: terminalApp.cwd,
      pty,
      dataSubscription: { dispose: () => {} },
      exitSubscription: { dispose: () => {} },
      subscribers: new Map(),
      scrollback: "",
      pendingOutput: "",
      pendingOutputStartOffset: 0,
      outputEndOffset: 0,
      flushTimer: null,
      exitReapTimer: null,
      lastUsedAt: this.deps.now(),
    };

    session.dataSubscription = pty.onData((chunk) => {
      session.scrollback = trimScrollback(session.scrollback + chunk);
      session.outputEndOffset += chunk.length;
      this.enqueueOutput(session, chunk);
    });

    session.exitSubscription = pty.onExit((event) => {
      this.markExited(session, {
        exitCode: event.exitCode,
        signal: event.signal ?? null,
      });
    });

    this.sessions.set(terminalApp.id, session);
    this.attach(params.sender, session);

    return {
      sessionId,
      shell: session.shell,
      cwd: session.cwd,
      appName: session.appName,
      scrollback: "",
      created: true,
      evicted,
    };
  }

  closeSession(sessionId: string, sender?: WebContents): void {
    const session = this.findSession(sessionId);
    if (!session || !sender) return;
    const subscriber = session.subscribers.get(sender.id);
    if (subscriber) {
      subscriber.attachmentCount -= 1;
      if (subscriber.attachmentCount <= 0) {
        session.subscribers.delete(sender.id);
      }
    }
    if (session.exited) {
      this.scheduleExitedSessionReap(session);
    }
  }

  write(sessionId: string, data: string, sender?: WebContents): void {
    const session = this.findAuthorizedSession(sessionId, sender);
    if (!session?.pty) {
      throw new DyadError(
        "Terminal session is not running",
        DyadErrorKind.Precondition,
      );
    }
    session.lastUsedAt = this.deps.now();
    session.pty.write(data);
  }

  resize(
    sessionId: string,
    cols: number,
    rows: number,
    sender?: WebContents,
  ): void {
    const session = this.findAuthorizedSession(sessionId, sender);
    if (!session?.pty) return;
    session.lastUsedAt = this.deps.now();
    session.pty.resize(cols, rows);
  }

  serialize(
    sessionId: string,
    sender?: WebContents,
  ): SerializedTerminalSession {
    const session = this.findAuthorizedSession(sessionId, sender);
    if (!session) {
      throw new DyadError("Terminal session not found", DyadErrorKind.NotFound);
    }
    if (sender) {
      const subscriber = session.subscribers.get(sender.id);
      if (subscriber) {
        subscriber.nextOutputOffset = session.outputEndOffset;
      }
    }
    return {
      scrollback: session.scrollback,
      scrollbackEndOffset: session.outputEndOffset,
    };
  }

  killSession(sessionId: string, sender?: WebContents): void {
    const session = this.findAuthorizedSession(sessionId, sender);
    if (!session) return;
    this.disposeSession(session, { remove: true, notifyExit: true });
  }

  killForApp(appId: number): void {
    const session = this.sessions.get(appId);
    if (!session) return;
    this.disposeSession(session, { remove: true, notifyExit: true });
  }

  killAll(): void {
    for (const session of Array.from(this.sessions.values())) {
      this.disposeSession(session, { remove: true, notifyExit: false });
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getLiveSessionCount(): number {
    return Array.from(this.sessions.values()).filter((session) => session.pty)
      .length;
  }

  private attach(sender: WebContents | undefined, session: PtySession): void {
    if (!sender || sender.isDestroyed()) return;
    const existingSubscriber = session.subscribers.get(sender.id);
    if (existingSubscriber) {
      existingSubscriber.webContents = sender;
      existingSubscriber.attachmentCount += 1;
      return;
    }

    session.subscribers.set(sender.id, {
      webContents: sender,
      nextOutputOffset: session.outputEndOffset,
      attachmentCount: 1,
    });
  }

  private findSession(sessionId: string): PtySession | undefined {
    return Array.from(this.sessions.values()).find(
      (session) => session.sessionId === sessionId,
    );
  }

  private findAuthorizedSession(
    sessionId: string,
    sender?: WebContents,
  ): PtySession | undefined {
    const session = this.findSession(sessionId);
    if (!session || !sender) {
      return session;
    }

    this.removeDestroyedSubscribers(session);
    if (sender.isDestroyed() || !session.subscribers.has(sender.id)) {
      throw new DyadError(
        "Terminal session is not attached to this window",
        DyadErrorKind.Precondition,
      );
    }
    return session;
  }

  private removeDestroyedSubscribers(session: PtySession): void {
    for (const [id, subscriber] of session.subscribers) {
      if (subscriber.webContents.isDestroyed()) {
        session.subscribers.delete(id);
      }
    }
  }

  private sendToSubscribers(
    session: PtySession,
    channel: string,
    payload: unknown,
  ): void {
    this.removeDestroyedSubscribers(session);
    for (const subscriber of session.subscribers.values()) {
      this.deps.send(subscriber.webContents, channel, payload);
    }
  }

  private enqueueOutput(session: PtySession, chunk: string): void {
    if (!session.pendingOutput) {
      session.pendingOutputStartOffset = session.outputEndOffset - chunk.length;
    }
    session.pendingOutput += chunk;
    if (session.flushTimer) return;

    session.flushTimer = setTimeout(() => {
      this.flushOutput(session);
    }, OUTPUT_FLUSH_DELAY_MS);
  }

  private flushOutput(session: PtySession): void {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }

    if (!session.pendingOutput) return;
    const chunk = session.pendingOutput;
    const chunkStartOffset = session.pendingOutputStartOffset;
    const chunkEndOffset = chunkStartOffset + chunk.length;
    session.pendingOutput = "";
    session.pendingOutputStartOffset = session.outputEndOffset;
    this.removeDestroyedSubscribers(session);
    const channel = buildTerminalDataChannel(session.sessionId);
    for (const subscriber of session.subscribers.values()) {
      const offset = Math.min(
        Math.max(subscriber.nextOutputOffset - chunkStartOffset, 0),
        chunk.length,
      );
      subscriber.nextOutputOffset = chunkEndOffset;
      const visibleChunk = chunk.slice(offset);
      if (!visibleChunk) continue;
      this.deps.send(subscriber.webContents, channel, {
        sessionId: session.sessionId,
        chunk: visibleChunk,
        startOffset: chunkStartOffset + offset,
        endOffset: chunkEndOffset,
      });
    }
  }

  private markExited(session: PtySession, exit: TerminalExit): void {
    if (session.exited) return;
    this.flushOutput(session);
    session.exited = exit;
    session.exitedAt = this.deps.now();
    session.pty = null;
    session.dataSubscription.dispose();
    session.exitSubscription.dispose();
    this.sendToSubscribers(
      session,
      buildTerminalExitChannel(session.sessionId),
      {
        sessionId: session.sessionId,
        exitCode: exit.exitCode,
        signal: exit.signal ?? null,
      },
    );
    this.scheduleExitedSessionReap(session);
  }

  private clearExitedSessionReapTimer(session: PtySession): void {
    if (!session.exitReapTimer) return;
    clearTimeout(session.exitReapTimer);
    session.exitReapTimer = null;
  }

  private scheduleExitedSessionReap(session: PtySession): void {
    if (!session.exited) return;
    this.clearExitedSessionReapTimer(session);
    session.exitReapTimer = setTimeout(() => {
      session.exitReapTimer = null;
      this.removeDestroyedSubscribers(session);
      if (!session.exited) return;
      if (session.subscribers.size > 0) {
        this.scheduleExitedSessionReap(session);
        return;
      }
      this.disposeSession(session, { remove: true, notifyExit: false });
    }, EXITED_SESSION_TTL_MS);
    session.exitReapTimer.unref?.();
  }

  private disposeSession(
    session: PtySession,
    options: { remove: boolean; notifyExit: boolean },
  ): void {
    this.clearExitedSessionReapTimer(session);
    this.flushOutput(session);
    if (session.pty) {
      try {
        terminatePtyProcess(session.pty);
      } catch (error) {
        logger.warn("Failed to terminate PTY:", error);
      }
    }
    session.dataSubscription.dispose();
    session.exitSubscription.dispose();

    if (options.notifyExit && !session.exited) {
      this.sendToSubscribers(
        session,
        buildTerminalExitChannel(session.sessionId),
        {
          sessionId: session.sessionId,
          exitCode: null,
          signal: null,
        },
      );
    }

    session.pty = null;
    session.exited = { exitCode: null, signal: null };
    session.exitedAt = this.deps.now();
    if (options.remove) {
      this.sessions.delete(session.appId);
    }
  }

  private evictLeastRecentlyUsedSession():
    | { appId: number; appName: string }
    | undefined {
    if (this.getLiveSessionCount() < MAX_LIVE_SESSIONS) {
      return undefined;
    }

    const liveSessions = Array.from(this.sessions.values()).filter(
      (session) => session.pty,
    );
    liveSessions.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const sessionToEvict = liveSessions[0];
    if (!sessionToEvict) {
      return undefined;
    }

    this.disposeSession(sessionToEvict, { remove: true, notifyExit: true });
    return {
      appId: sessionToEvict.appId,
      appName: sessionToEvict.appName,
    };
  }
}

let ptySessionManager: PtySessionManager | null = null;

export function getPtySessionManager(): PtySessionManager {
  if (!ptySessionManager) {
    ptySessionManager = new PtySessionManager({
      resolveApp: defaultResolveApp,
      pathExists: (targetPath) => {
        try {
          const stat = fs.statSync(targetPath);
          return stat.isDirectory();
        } catch {
          return false;
        }
      },
      ptySpawner: defaultSpawnPty as TerminalPtySpawner,
      getShellEnv: defaultGetShellEnv,
      send: safeSend,
      now: () => Date.now(),
    });
  }
  return ptySessionManager;
}
