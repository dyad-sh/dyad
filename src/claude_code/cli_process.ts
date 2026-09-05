/**
 * Thin lifecycle wrapper around one `claude -p` process speaking the
 * stream-json protocol over stdin/stdout.
 *
 * Responsibilities: spawn, line-parse stdout, route control requests
 * (permission prompts and in-process MCP traffic) to the caller, and provide
 * an escalating cancellation path (interrupt → SIGTERM → SIGKILL).
 */
import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import log from "electron-log";
import { buildWindowsCommandInvocation } from "@/ipc/utils/windows_command";
import { killProcessTreeSync } from "@/ipc/utils/kill_process_tree_sync";
import {
  isCanUseToolRequest,
  isMcpMessageRequest,
  parseCliLine,
  type CliCanUseToolRequest,
  type CliControlRequestEvent,
  type CliEvent,
  type CliMcpMessageRequest,
  type CliStdinMessage,
  type CliUserContentBlock,
} from "./stream_json_protocol";

const logger = log.scope("claude_code_cli_process");

const MAX_STDERR_BYTES = 32 * 1024;

export type CanUseToolResponse =
  | { behavior: "allow"; updatedInput: unknown }
  | { behavior: "deny"; message: string };

export interface ClaudeCliProcessHandlers {
  onEvent: (event: CliEvent) => void;
  onCanUseTool: (request: CliCanUseToolRequest) => Promise<CanUseToolResponse>;
  /**
   * Handle one JSON-RPC message for an in-process MCP server. Return the
   * JSON-RPC response object, or null for notifications.
   */
  onMcpMessage: (request: CliMcpMessageRequest) => Promise<unknown | null>;
  onStderr?: (text: string) => void;
  onUnparsedLine?: (line: string) => void;
}

export interface ClaudeCliExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  spawnError: Error | null;
}

export interface ClaudeCliSpawnOptions {
  executablePath: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  handlers: ClaudeCliProcessHandlers;
}

export class ClaudeCliProcess {
  readonly exited: Promise<ClaudeCliExit>;
  private readonly child: ChildProcess;
  private stderrBuffer = "";
  private sawResult = false;
  private exitInfo: ClaudeCliExit | null = null;
  private stdinClosed = false;
  private interruptCounter = 0;

  private constructor(
    child: ChildProcess,
    private readonly handlers: ClaudeCliProcessHandlers,
  ) {
    this.child = child;
    this.exited = new Promise<ClaudeCliExit>((resolve) => {
      let settled = false;
      const settle = (info: ClaudeCliExit) => {
        if (settled) return;
        settled = true;
        this.exitInfo = info;
        resolve(info);
      };
      child.on("error", (error) => {
        settle({
          code: null,
          signal: null,
          stderr: this.stderrBuffer,
          spawnError: error,
        });
      });
      child.on("close", (code, signal) => {
        settle({
          code,
          signal,
          stderr: this.stderrBuffer,
          spawnError: null,
        });
      });
    });
    this.wireStreams();
  }

  static spawn(options: ClaudeCliSpawnOptions): ClaudeCliProcess {
    const invocation = buildWindowsCommandInvocation(
      options.executablePath,
      options.args,
    );
    logger.debug(
      `Spawning Claude Code: ${invocation.command} ${invocation.args
        .map((arg) => (arg.length > 80 ? `${arg.slice(0, 77)}...` : arg))
        .join(" ")}`,
    );
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    return new ClaudeCliProcess(child, options.handlers);
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get hasExited(): boolean {
    return this.exitInfo !== null;
  }

  get receivedResult(): boolean {
    return this.sawResult;
  }

  private wireStreams(): void {
    const { child } = this;
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderrBuffer = (this.stderrBuffer + chunk).slice(-MAX_STDERR_BYTES);
      this.handlers.onStderr?.(chunk);
    });
    child.stdin?.on("error", (error) => {
      // EPIPE after the CLI exits is expected during teardown.
      logger.debug("Claude Code stdin error", error);
    });
    if (child.stdout) {
      const rl = readline.createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        this.handleLine(line);
      });
    }
  }

  private handleLine(line: string): void {
    const parsed = parseCliLine(line);
    if (!parsed) return;
    if (parsed.kind === "invalid") {
      this.handlers.onUnparsedLine?.(parsed.raw);
      return;
    }
    if (parsed.kind === "unknown") {
      logger.debug(
        `Unrecognized Claude Code event: ${parsed.raw.slice(0, 200)}`,
      );
      return;
    }
    const { event } = parsed;
    if (event.type === "control_request") {
      void this.handleControlRequest(event);
      return;
    }
    if (event.type === "result") {
      this.sawResult = true;
    }
    try {
      this.handlers.onEvent(event);
    } catch (error) {
      logger.error("Claude Code event handler threw", error);
    }
  }

  private async handleControlRequest(
    event: CliControlRequestEvent,
  ): Promise<void> {
    const { request } = event;
    try {
      if (isCanUseToolRequest(request)) {
        const decision = await this.handlers.onCanUseTool(request);
        this.write({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: event.request_id,
            response:
              decision.behavior === "allow"
                ? { behavior: "allow", updatedInput: decision.updatedInput }
                : { behavior: "deny", message: decision.message },
          },
        });
        return;
      }
      if (isMcpMessageRequest(request)) {
        const mcpResponse = await this.handlers.onMcpMessage(request);
        this.write({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: event.request_id,
            response: { mcp_response: mcpResponse ?? null },
          },
        });
        return;
      }
      this.write({
        type: "control_response",
        response: {
          subtype: "error",
          request_id: event.request_id,
          error: `Dyad does not handle control request ${request.subtype}`,
        },
      });
    } catch (error) {
      logger.error(`Control request ${request.subtype} failed`, error);
      this.write({
        type: "control_response",
        response: {
          subtype: "error",
          request_id: event.request_id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private write(message: CliStdinMessage): void {
    if (this.stdinClosed || this.exitInfo || !this.child.stdin?.writable) {
      return;
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  sendUserMessage(content: string | CliUserContentBlock[]): void {
    this.write({ type: "user", message: { role: "user", content } });
  }

  /** Ask the CLI to stop the current turn; it replies with a result event. */
  interrupt(): void {
    this.interruptCounter += 1;
    this.write({
      type: "control_request",
      request_id: `dyad-interrupt-${this.interruptCounter}`,
      request: { subtype: "interrupt" },
    });
  }

  closeStdin(): void {
    if (this.stdinClosed) return;
    this.stdinClosed = true;
    try {
      this.child.stdin?.end();
    } catch (error) {
      logger.debug("Failed to close Claude Code stdin", error);
    }
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.exitInfo) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => resolve(false), timeoutMs);
      void this.exited.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /**
   * Escalating shutdown: interrupt the turn (lets the CLI flush usage), then
   * SIGTERM, then a process-tree kill. Resolves once the process has exited.
   */
  async terminate({
    interruptGraceMs = 3_000,
    termGraceMs = 3_000,
  }: { interruptGraceMs?: number; termGraceMs?: number } = {}): Promise<void> {
    if (this.exitInfo) return;
    this.interrupt();
    this.closeStdin();
    if (await this.waitForExit(interruptGraceMs)) return;
    logger.warn("Claude Code did not exit after interrupt; sending SIGTERM");
    try {
      this.child.kill("SIGTERM");
    } catch (error) {
      logger.debug("SIGTERM failed", error);
    }
    if (await this.waitForExit(termGraceMs)) return;
    logger.warn("Claude Code did not exit after SIGTERM; killing process tree");
    this.killTree();
    await this.waitForExit(2_000);
  }

  /** Immediate, synchronous kill for app shutdown paths. */
  killTree(): void {
    if (this.exitInfo || this.child.pid === undefined) return;
    try {
      if (!killProcessTreeSync(this.child.pid)) {
        this.child.kill("SIGKILL");
      }
    } catch (error) {
      logger.debug("Process tree kill failed", error);
      try {
        this.child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}
