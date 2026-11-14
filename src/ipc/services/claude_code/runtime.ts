import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import {
  claudeUsageGeneration,
  recordClaudeUsageLimits,
  setClaudeUsageAccount,
} from "./usage_limits";
import treeKill from "tree-kill";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { safeGithubOpsErrorMessage } from "@/ipc/services/github_ops_safe_error";
import { killProcessTreeSync } from "@/ipc/utils/kill_process_tree_sync";
import {
  ClaudeCodeModelsSchema,
  type ClaudeCodeModel,
} from "@/shared/claude_code_models";

const execFileAsync = promisify(execFile);
const running = new Set<ChildProcess>();
const MAX_CLI_DIAGNOSTIC_LENGTH = 4_000;

export function safeClaudeDiagnostic(raw: string): string | undefined {
  // The shared redactor treats "OAuth token: another..." as a secret assignment
  // and /login as a private path. Sanitize around only these fixed CLI phrases
  // so a later path on the same line cannot consume the guidance before it.
  const bounded = raw.slice(0, MAX_CLI_DIAGNOSTIC_LENGTH);
  const fixedGuidance =
    /OAuth token: another Claude Code process is refreshing it or exited mid-refresh\.|(?<![\w/\\.-])\/login(?![\w/\\-]|\.[\w])/g;
  const sanitizePart = (part: string) => {
    const leading = part.match(/^\s*/)?.[0] ?? "";
    const trailing = part.match(/\s*$/)?.[0] ?? "";
    const core = part.trim();
    if (!core) return part;
    return leading + safeGithubOpsErrorMessage(new Error(core), "") + trailing;
  };
  let restored = "";
  let offset = 0;
  for (const match of bounded.matchAll(fixedGuidance)) {
    restored += sanitizePart(bounded.slice(offset, match.index)) + match[0];
    offset = match.index + match[0].length;
  }
  restored += sanitizePart(bounded.slice(offset));
  restored = restored.trim();
  if (!restored) return undefined;
  const maxLength = MAX_CLI_DIAGNOSTIC_LENGTH - "Claude Code: ".length;
  return restored.length <= maxLength
    ? restored
    : `${restored.slice(0, maxLength - 14)}… [truncated]`;
}

// No provider keys, proxy overrides, credential helpers or inherited Claude
// switches. Authentication stays inside the official CLI and OS keychain.
export function claudeEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    [
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "PATH",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "USER",
      "LOGNAME",
    ].flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  );
}

export async function findClaudeExecutable(): Promise<string> {
  const binary = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    path.join(homedir(), ".local", "bin", binary),
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, binary)),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* try next native binary */
    }
  }
  throw new DyadError(
    "Install the official Claude Code native CLI, then run claude auth login in your terminal.",
    DyadErrorKind.Precondition,
  );
}

/** Oldest CLI verified with native tools and session continuity
 * (`--permission-prompt-tool stdio` with SDK hooks, `--system-prompt-snapshot`,
 * `--resume-session-at`). Older CLIs keep the Dyad-tools path. */
export const NATIVE_HARNESS_MIN_VERSION = "2.1.325";

function compareVersions(a: string, b: string): number | undefined {
  const parse = (v: string) =>
    /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return undefined;
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

export function isNativeHarnessVersionSupported(
  version: string | null | undefined,
): boolean {
  const order = version
    ? compareVersions(version, NATIVE_HARNESS_MIN_VERSION)
    : undefined;
  return order !== undefined && order >= 0;
}

export function isClaudeVersionSupported(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return (
    major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 259)))
  );
}
let statusCache:
  | { value: Awaited<ReturnType<typeof probeClaudeStatus>>; expires: number }
  | undefined;
let statusFlight:
  | Promise<Awaited<ReturnType<typeof probeClaudeStatus>>>
  | undefined;
export function claudeStatus(options?: { force?: boolean }) {
  if (options?.force) statusCache = undefined;
  if (statusFlight) return statusFlight;
  if (statusCache && statusCache.expires > Date.now())
    return Promise.resolve(statusCache.value);
  statusFlight = probeClaudeStatus()
    .then((value) => {
      statusCache = {
        value,
        expires: Date.now() + (value.connected ? 30_000 : 5_000),
      };
      return value;
    })
    .finally(() => {
      statusFlight = undefined;
    });
  return statusFlight;
}
async function probeClaudeStatus() {
  let installed = false;
  let version: string | null = null;
  let compatible = false;
  try {
    const executable = await findClaudeExecutable();
    installed = true;
    const options = {
      env: claudeEnvironment(),
      timeout: 10_000,
      maxBuffer: 64_000,
      windowsHide: true,
    };
    const { stdout: versionText } = await execFileAsync(
      executable,
      ["--version"],
      options,
    );
    version = versionText.match(/\d+\.\d+\.\d+/)?.[0] ?? "unknown";
    compatible = isClaudeVersionSupported(version);
    const { stdout } = await execFileAsync(
      executable,
      ["auth", "status"],
      options,
    );
    const auth = z
      .object({
        loggedIn: z.boolean(),
        authMethod: z.string().optional(),
        subscriptionType: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        orgId: z.string().nullable().optional(),
      })
      .parse(JSON.parse(stdout));
    const connected = auth.loggedIn && auth.authMethod === "claude.ai";
    setClaudeUsageAccount(
      connected ? JSON.stringify([auth.email, auth.orgId]) : null,
    );
    return {
      installed: true,
      connected,
      compatible,
      version,
      detail: !compatible
        ? "Claude Code 2.1.259 or later is required. Update the official CLI. Dyad validates the restricted tool inventory on every turn."
        : connected
          ? "Signed in through the official Claude Code CLI."
          : "Run claude auth login in your terminal to use your subscription.",
    };
  } catch {
    setClaudeUsageAccount(null);
    return {
      installed,
      connected: false,
      compatible,
      version,
      detail: installed
        ? "Claude Code is installed, but its status could not be checked. Run claude auth status in your terminal and reconnect with claude auth login if needed."
        : "Install Claude Code from code.claude.com, then run claude auth login in your terminal. Dyad never collects subscription credentials.",
    };
  }
}

/** Read the same initialization catalog used by the SDK's supportedModels().
 * No user message is sent, so discovery never starts an inference turn. */
let modelsFlight: Promise<ClaudeCodeModel[]> | undefined;
export function listClaudeModels(): Promise<ClaudeCodeModel[]> {
  modelsFlight ??= probeClaudeModels().finally(() => {
    modelsFlight = undefined;
  });
  return modelsFlight;
}
async function probeClaudeModels(): Promise<ClaudeCodeModel[]> {
  const executable = await findClaudeExecutable();
  const cwd = await mkdtemp(path.join(tmpdir(), "dyad-claude-models-"));
  try {
    return await new Promise<ClaudeCodeModel[]>((resolve, reject) => {
      const requestId = randomUUID();
      const child = spawn(
        executable,
        [
          "-p",
          "--restricted",
          "--disable-slash-commands",
          "--no-chrome",
          "--strict-mcp-config",
          "--mcp-config",
          JSON.stringify({ mcpServers: {} }),
          "--settings",
          JSON.stringify({
            disableAllHooks: true,
            enabledPlugins: {},
            autoMemoryEnabled: false,
          }),
          "--tools",
          "",
          "--no-session-persistence",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
        ],
        {
          cwd,
          env: claudeEnvironment(),
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          detached: process.platform !== "win32",
        },
      );
      running.add(child);
      const decoder = new StringDecoder("utf8");
      let buffer = "";
      let bytes = 0;
      let models: ClaudeCodeModel[] | undefined;
      let failure: DyadError | undefined;
      let closed = false;
      const fail = () => {
        failure ??= new DyadError(
          "Could not load Claude Code models. Refresh the connection and try again.",
          DyadErrorKind.External,
        );
        if (!closed) stopClaudeProcess(child);
      };
      const timeout = setTimeout(fail, 10_000);
      const consume = (line: string) => {
        if (!line.trim() || models || failure) return;
        try {
          const event = JSON.parse(line);
          if (
            event.type !== "control_response" ||
            event.response?.request_id !== requestId
          )
            return;
          if (event.response.subtype !== "success") {
            fail();
            return;
          }
          // Parse explicitly: never return the rest of the initialization response.
          models = ClaudeCodeModelsSchema.parse(
            event.response.response?.models,
          );
          // The disposable probe has no conversation or pending tools to finish.
          if (!closed) stopClaudeProcess(child);
        } catch {
          fail();
        }
      };
      child.stdout.on("data", (data: Buffer) => {
        if (models || failure) return;
        bytes += data.length;
        if (bytes > 1024 * 1024) {
          fail();
          return;
        }
        buffer += decoder.write(data);
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          consume(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
      });
      // Do not expose CLI diagnostics or account information to logs/telemetry.
      child.stderr.resume();
      child.stdin.on("error", () => {
        if (!models) fail();
      });
      child.once("error", fail);
      child.once("close", () => {
        closed = true;
        clearTimeout(timeout);
        running.delete(child);
        consume(buffer + decoder.end());
        if (models && !failure) resolve(models);
        else {
          fail();
          reject(failure);
        }
      });
      child.stdin.write(
        JSON.stringify({
          type: "control_request",
          request_id: requestId,
          request: { subtype: "initialize" },
        }) + "\n",
      );
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export type CliEvent = Record<string, any>;

/** A control request the CLI sends to the host (`can_use_tool`,
 * `hook_callback`, …). The handler's return value becomes the success
 * response; a thrown error becomes an error response. */
export interface CliControlRequest {
  subtype: string;
  [key: string]: unknown;
}

/** Options that turn a Claude Code turn into a native-tools turn. */
export interface NativeTurnOptions {
  /** Explicit built-in tool allowlist. Names the installed CLI does not have
   * are ignored by the CLI, so one list works across versions. */
  tools: string[];
  permissionMode: "auto" | "default";
  /** Dyad context appended to Claude Code's own system prompt. */
  appendSystemPromptPath: string;
  /** Hook callback ids registered through `initialize`, by hook event. */
  hooks: Record<string, string[]>;
  /** Extra readable folders (referenced apps). Dyad's PreToolUse guard still
   * blocks file-tool edits inside other Dyad apps. */
  addDirs?: string[];
}

export interface BackendTurn {
  cwd: string;
  prompt: string;
  content?: Array<Record<string, unknown>>;
  model: string;
  sessionId: string;
  resume: boolean;
  /** Resume only up to this assistant message uuid, in a forked session. */
  resumeAt?: string;
  /** Render the system prompt on every request instead of freezing it for
   * the session, so one session can serve turns with different prompts. */
  freshSystemPrompt?: boolean;

  signal: AbortSignal;
  mcpConfigPath: string;
  /** Exact host-owned tool inventory. No native operational tools. */
  dyadTools?: string[];
  systemPromptPath?: string;
  maxTurns?: number;
  native?: NativeTurnOptions;
  onEvent(event: CliEvent): Promise<void | "interrupt">;
  /** Answers control requests from the CLI. Runs concurrently with event
   * handling, so a long human decision cannot stall the event stream. */
  onControlRequest?(
    request: CliControlRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>>;
  /** Receives a sender for additional user messages while the turn runs
   * (steering). It returns false once the turn can no longer accept input. */
  onInputReady?(send: (text: string) => boolean): void;
  /** Test seam: run a different executable (e.g. node + fake CLI script). */
  command?: { executable: string; args: string[] };
}

/** How long a native turn's CLI may keep running after its `result` before
 * Dyad stops its process group. Background Bash tasks keep the CLI alive. */
export const NATIVE_RESULT_EXIT_GRACE_MS = 1_500;

export function claudeArguments(
  turn: Omit<BackendTurn, "onEvent" | "signal">,
): string[] {
  const session = [
    turn.resume ? "--resume" : "--session-id",
    turn.sessionId,
    ...(turn.resume && turn.resumeAt
      ? ["--resume-session-at", turn.resumeAt, "--fork-session"]
      : []),
  ];
  const stream = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
  const snapshot = turn.freshSystemPrompt
    ? ["--system-prompt-snapshot", "off"]
    : [];
  if (turn.native) {
    // "Like the terminal": the user's settings, CLAUDE.md, skills, plugins,
    // hooks and MCP servers all load. Dyad adds its own MCP server and hooks.
    return [
      "-p",
      "--no-chrome",
      "--mcp-config",
      turn.mcpConfigPath,
      "--tools",
      turn.native.tools.join(","),
      "--permission-mode",
      turn.native.permissionMode,
      "--permission-prompt-tool",
      "stdio",
      "--setting-sources",
      "user,project,local",
      "--append-system-prompt-file",
      turn.native.appendSystemPromptPath,
      ...(turn.native.addDirs ?? []).flatMap((dir) => ["--add-dir", dir]),
      ...snapshot,
      ...(turn.maxTurns ? ["--max-turns", String(turn.maxTurns)] : []),
      "--model",
      turn.model,
      ...session,
      ...stream,
      "--forward-subagent-text",
    ];
  }
  return [
    "-p",
    "--restricted",
    "--disable-slash-commands",
    "--no-chrome",
    "--strict-mcp-config",
    "--mcp-config",
    turn.mcpConfigPath,
    "--settings",
    JSON.stringify({
      disableAllHooks: true,
      enabledPlugins: {},
      autoMemoryEnabled: false,
    }),
    "--tools",
    "",
    "--permission-mode",
    "manual",
    ...(turn.dyadTools?.length
      ? ["--allowedTools", turn.dyadTools.join(",")]
      : []),
    ...(turn.systemPromptPath
      ? ["--system-prompt-file", turn.systemPromptPath]
      : []),
    ...snapshot,
    ...(turn.maxTurns ? ["--max-turns", String(turn.maxTurns)] : []),
    "--model",
    turn.model,
    ...session,
    ...stream,
  ];
}

/**
 * The CLI's hard wall-clock limit per MCP tool call (progress notifications do
 * not extend it). Dyad tools park on human input — questionnaires have no
 * deadline at all — so this must outlast every user-input registry deadline;
 * otherwise the CLI abandons the call while Dyad is still waiting. The CLI
 * clamps the value to this signed 32-bit maximum (~24.8 days), which is the
 * longest wait it allows.
 */
export const CLAUDE_MCP_TOOL_TIMEOUT_MS = 2_147_483_647;

/** CLI owns inference. Its adapter emits provider-executed events to Dyad;
 * the SDK must never execute those tool calls again. */
export async function runClaudeTurn(turn: BackendTurn): Promise<void> {
  turn.signal.throwIfAborted();
  const usageGeneration = claudeUsageGeneration();
  const executable = turn.command?.executable ?? (await findClaudeExecutable());
  const args = [...(turn.command?.args ?? []), ...claudeArguments(turn)];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: turn.cwd,
      env: {
        ...claudeEnvironment(),
        MCP_TOOL_TIMEOUT: String(CLAUDE_MCP_TOOL_TIMEOUT_MS),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    running.add(child);
    let buffer = "";
    const decoder = new StringDecoder("utf8");
    let failure: Error | undefined;
    let events = Promise.resolve();
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let interruptTimer: ReturnType<typeof setTimeout> | undefined;
    let interruptedWithResult = false;
    let resultReceived = false;
    let resultStopTimer: ReturnType<typeof setTimeout> | undefined;
    let cliError: string | undefined;
    let stderr = "";
    // Control requests run beside the ordered event chain: a permission
    // prompt can wait on a human while the CLI keeps streaming other events.
    const controlRequests = new Map<string, AbortController>();
    const writeLine = (value: unknown): boolean => {
      if (child.stdin.destroyed || child.stdin.writableEnded) return false;
      child.stdin.write(JSON.stringify(value) + "\n");
      return true;
    };
    const answerControlRequest = (event: CliEvent) => {
      const requestId = String(event.request_id ?? "");
      const request = event.request as CliControlRequest | undefined;
      if (!requestId || !request || typeof request.subtype !== "string") return;
      const controller = new AbortController();
      controlRequests.set(requestId, controller);
      const respond = (response: Record<string, unknown>) =>
        writeLine({ type: "control_response", response });
      const handler = turn.onControlRequest;
      void (async () => {
        try {
          if (!handler)
            throw new Error(`Unsupported control request: ${request.subtype}`);
          const result = await handler(
            request,
            AbortSignal.any([controller.signal, turn.signal]),
          );
          if (controller.signal.aborted) return;
          respond({
            subtype: "success",
            request_id: requestId,
            response: result,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          respond({
            subtype: "error",
            request_id: requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          controlRequests.delete(requestId);
        }
      })();
    };
    const signalProcess = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, signal);
        else if (child.pid) treeKill(child.pid, signal, () => {});
      } catch {
        /* already exited */
      }
    };
    const abort = () => {
      signalProcess("SIGINT");
      killTimer ??= setTimeout(() => signalProcess("SIGKILL"), 5000);
    };
    const consume = (line: string) => {
      if (!line.trim()) return;
      events = events
        .then(async () => {
          if (failure) return;
          const parsed: CliEvent = JSON.parse(line);
          if (parsed.type === "control_request") {
            answerControlRequest(parsed);
            return;
          }
          if (parsed.type === "control_cancel_request") {
            controlRequests
              .get(String(parsed.request_id ?? ""))
              ?.abort(new Error("Claude Code cancelled the request"));
            return;
          }
          // Responses to Dyad's own control requests (initialize, interrupt).
          if (parsed.type === "control_response") return;
          recordClaudeUsageLimits(parsed, usageGeneration);
          if (
            parsed.type === "assistant" &&
            parsed.message?.model === "<synthetic>" &&
            Array.isArray(parsed.message.content)
          ) {
            const text = parsed.message.content
              ?.filter(
                (part: { type?: string; text?: unknown }) =>
                  part.type === "text" && typeof part.text === "string",
              )
              .map((part: { text: string }) => part.text)
              .join("\n");
            if (text) cliError = text.slice(0, MAX_CLI_DIAGNOSTIC_LENGTH);
          }
          if (
            parsed.type === "result" &&
            parsed.is_error &&
            typeof parsed.result === "string" &&
            !cliError
          )
            cliError = parsed.result.slice(0, MAX_CLI_DIAGNOSTIC_LENGTH);
          const action = await turn.onEvent(parsed);
          if (parsed.type === "result") {
            resultReceived = true;
            interruptedWithResult = interruptTimer !== undefined;
            if (interruptTimer) clearTimeout(interruptTimer);
            child.stdin.end();
            // A background Bash task keeps the CLI alive after its result.
            // The turn is over: stop the whole process group, which also
            // ends anything Claude started in the background.
            if (turn.native)
              resultStopTimer ??= setTimeout(
                abort,
                NATIVE_RESULT_EXIT_GRACE_MS,
              );
          } else if (action === "interrupt" && !interruptTimer) {
            // Protocol interruption lets the CLI flush authoritative modelUsage.
            // Operational tool admission is already closed by the adapter.
            child.stdin.write(
              JSON.stringify({
                type: "control_request",
                request_id: randomUUID(),
                request: { subtype: "interrupt" },
              }) + "\n",
            );
            interruptTimer = setTimeout(abort, 10_000);
          }
        })
        .catch((error) => {
          failure =
            error instanceof Error ? error : new Error("Invalid CLI stream");
          abort();
        });
    };
    child.stdout.on("data", (data: Buffer) => {
      if (failure) return; // keep draining discarded bytes after a protocol error
      child.stdout.pause();
      buffer += decoder.write(data);
      if (Buffer.byteLength(buffer, "utf8") > 8 * 1024 * 1024) {
        failure = new DyadError(
          "Claude Code stream frame exceeded limit",
          DyadErrorKind.External,
        );
        abort();
        buffer = "";
        child.stdout.resume();
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      void events.finally(() => child.stdout.resume());
    });
    // Keep only a bounded diagnostic for the user; never log raw CLI output.
    child.stderr.on("data", (data: Buffer) => {
      if (stderr.length < MAX_CLI_DIAGNOSTIC_LENGTH)
        stderr += data
          .toString("utf8")
          .slice(0, MAX_CLI_DIAGNOSTIC_LENGTH - stderr.length);
    });
    child.stdin.on("error", () => {
      /* process-close path reports failure */
    });
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => {
      running.delete(child);
      turn.signal.removeEventListener("abort", abort);
      if (killTimer) clearTimeout(killTimer);
      if (interruptTimer) clearTimeout(interruptTimer);
      if (resultStopTimer) clearTimeout(resultStopTimer);
      for (const controller of controlRequests.values())
        controller.abort(new Error("Claude Code exited"));
      consume(buffer + decoder.end());
      void events.then(() => {
        if (failure) return reject(failure);
        if (
          code === 0 ||
          turn.signal.aborted ||
          interruptedWithResult ||
          // Native turns stop the CLI themselves once the result arrives.
          (turn.native && resultReceived)
        )
          return resolve();
        const diagnostic = safeClaudeDiagnostic(cliError ?? stderr);
        return reject(
          new DyadError(
            diagnostic
              ? `Claude Code: ${diagnostic}`
              : `Claude Code exited (${code ?? "signal"}). Check official CLI authentication or usage limits.`,
            // CLI diagnostics may contain private account or prompt data even
            // after redaction, so never forward them to exception telemetry.
            diagnostic ? DyadErrorKind.Precondition : DyadErrorKind.External,
          ),
        );
      });
    });
    turn.signal.addEventListener("abort", abort, { once: true });
    if (turn.signal.aborted) abort();
    if (turn.native)
      // Register Dyad's hooks before the first message so they cover
      // every tool call. The user's own hooks still run alongside them.
      writeLine({
        type: "control_request",
        request_id: randomUUID(),
        request: {
          subtype: "initialize",
          hooks: Object.fromEntries(
            Object.entries(turn.native.hooks).map(([event, ids]) => [
              event,
              [{ matcher: "", hookCallbackIds: ids }],
            ]),
          ),
        },
      });
    writeLine({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: turn.prompt }, ...(turn.content ?? [])],
      },
    });
    turn.onInputReady?.((text) =>
      resultReceived
        ? false
        : writeLine({
            type: "user",
            message: { role: "user", content: [{ type: "text", text }] },
          }),
    );
  });
}

function stopClaudeProcess(child: ChildProcess): void {
  try {
    if (process.platform !== "win32" && child.pid)
      process.kill(-child.pid, "SIGKILL");
    else if (child.pid) killProcessTreeSync(child.pid);
  } catch {
    /* already exited */
  }
}

export function stopClaudeProcesses(): void {
  for (const child of running) stopClaudeProcess(child);
}
