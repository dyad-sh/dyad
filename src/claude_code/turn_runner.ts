/**
 * Claude Code implementation of `ChatBackendTurnRunner`.
 *
 * Launches the official CLI for exactly one Dyad turn (new session or
 * explicit resume), streams its output as backend events, routes permission
 * prompts and Dyad-bridge MCP traffic, and classifies the outcome — including
 * usage reported on cancelled or failed turns.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import log from "electron-log";
import type {
  ChatBackendEvent,
  ChatBackendTurnContext,
  ChatBackendTurnFailureKind,
  ChatBackendTurnInput,
  ChatBackendTurnResult,
  ChatBackendTurnRunner,
  ChatBackendTurnUsage,
} from "@/chat_backend/backend";
import type { AgentToolConsent } from "@/lib/schemas";
import {
  buildClaudeCliEnvironment,
  getClaudeCodeAuthStatus,
  locateClaudeCodeCli,
  MIN_SUPPORTED_CLAUDE_CODE_VERSION,
  type ClaudeCodeCliLocation,
} from "./cli_locator";
import { ClaudeCliProcess } from "./cli_process";
import {
  buildDyadMcpConfig,
  handleDyadMcpMessage,
  type DyadMcpBridgeContext,
} from "./mcp_bridge";
import {
  buildClaudeCodeCliArgs,
  CLAUDE_CODE_MCP_SERVER_NAME,
  decideToolPermission,
  getBridgeToolNamesForMode,
} from "./permission_policy";
import {
  buildClaudeCodeSystemPromptAppendix,
  buildClaudeCodeUserMessage,
} from "./prompt_builder";
import {
  toolResultText,
  type CliEvent,
  type CliResultEvent,
} from "./stream_json_protocol";
import { normalizeCliResultUsage } from "./usage_normalization";

const logger = log.scope("claude_code_turn_runner");

const RESULT_EXIT_GRACE_MS = 5_000;
const SYNTHETIC_MODEL = "<synthetic>";

export interface ClaudeCodeTurnDependencies {
  /** Resolved once per turn; injectable for tests. */
  locateCli?: typeof locateClaudeCodeCli;
  getAuthStatus?: typeof getClaudeCodeAuthStatus;
  spawnProcess?: typeof ClaudeCliProcess.spawn;
  /** Bridge context factory (bound to the chat/app by the caller). */
  createBridgeContext: (
    signal: AbortSignal,
    emit: (event: ChatBackendEvent) => void,
  ) => Omit<DyadMcpBridgeContext, "signal" | "mode">;
  consents: Record<string, AgentToolConsent> | undefined;
  /** Optional prompt-appendix override (tests). */
  systemPromptAppendix?: string;
}

interface TurnState {
  sessionId: string | null;
  resolvedModel: string | null;
  finalText: string;
  result: CliResultEvent | null;
  syntheticError: string | null;
  /** Set when the CLI reported API-key (non-subscription) authentication. */
  apiKeyBillingRefusal: string | null;
  /** Installed after spawn so event handling can stop the process early. */
  requestTerminate: (() => void) | null;
  usageLimitHit: boolean;
  textBlocksStreamed: Set<string>;
  toolNamesByCallId: Map<string, string>;
  toolBlocksByIndex: Map<number, { id: string; name: string }>;
  lastStreamedMessageId: string | null;
}

function classifyFailure(
  state: TurnState,
  exit: { code: number | null; signal: NodeJS.Signals | null; stderr: string },
): { kind: ChatBackendTurnFailureKind; message: string } | null {
  const stderr = exit.stderr.trim();
  const resultText = state.result?.result?.trim() ?? "";
  const synthetic = state.syntheticError?.trim() ?? "";
  const haystack = `${resultText}\n${synthetic}\n${stderr}`;

  if (state.apiKeyBillingRefusal) {
    return { kind: "api-key-billing", message: state.apiKeyBillingRefusal };
  }

  if (/No conversation found with session ID/i.test(haystack)) {
    return {
      kind: "session-not-found",
      message:
        "The Claude Code session for this chat no longer exists on this machine, so it cannot be resumed. Start a new chat to continue with Claude Code.",
    };
  }
  if (
    /not logged in|please run \/login|authentication_error|invalid api key/i.test(
      haystack,
    )
  ) {
    return {
      kind: "unauthenticated",
      message:
        "Claude Code is not signed in. Run `claude` in a terminal, sign in with /login, then retry.",
    };
  }
  if (
    state.usageLimitHit ||
    /usage limit|rate limit|out of extra usage|limit reached/i.test(haystack)
  ) {
    return {
      kind: "usage-limit",
      message: `Your Claude subscription usage limit was reached. ${resultText || synthetic || "Wait for the limit to reset, then retry."}`,
    };
  }
  if (state.result?.is_error) {
    return {
      kind: "unknown",
      message:
        resultText ||
        stderr ||
        `Claude Code reported an error (${state.result.subtype ?? "unknown"}).`,
    };
  }
  if (!state.result) {
    return {
      kind: "crashed",
      message: `Claude Code exited (${exit.signal ?? exit.code ?? "unknown"}) before reporting a result.${stderr ? ` ${stderr.slice(0, 500)}` : ""}`,
    };
  }
  return null;
}

async function writeTurnFiles(
  input: ChatBackendTurnInput,
  systemPromptAppendix: string,
): Promise<{ dir: string; systemPromptFile: string; mcpConfigFile: string }> {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "dyad-claude-code-"),
  );
  const systemPromptFile = path.join(dir, "append-system-prompt.md");
  const mcpConfigFile = path.join(dir, "mcp-config.json");
  await fs.promises.writeFile(systemPromptFile, systemPromptAppendix, "utf8");
  await fs.promises.writeFile(
    mcpConfigFile,
    JSON.stringify(buildDyadMcpConfig()),
    "utf8",
  );
  void input;
  return { dir, systemPromptFile, mcpConfigFile };
}

export class ClaudeCodeTurnRunner implements ChatBackendTurnRunner {
  readonly backend = "claude-code" as const;

  constructor(private readonly deps: ClaudeCodeTurnDependencies) {}

  async runTurn(
    input: ChatBackendTurnInput,
    context: ChatBackendTurnContext,
  ): Promise<ChatBackendTurnResult> {
    const locate = this.deps.locateCli ?? locateClaudeCodeCli;
    const getAuth = this.deps.getAuthStatus ?? getClaudeCodeAuthStatus;
    const failure = (
      kind: ChatBackendTurnFailureKind,
      message: string,
    ): ChatBackendTurnResult => ({
      status: "error",
      sessionId: input.sessionId,
      resolvedModel: null,
      usage: null,
      finalText: "",
      error: { kind, message },
    });

    let cli: ClaudeCodeCliLocation | null;
    try {
      cli = await locate();
    } catch (error) {
      return failure(
        "not-installed",
        `Could not check for the Claude Code CLI: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!cli) {
      return failure(
        "not-installed",
        "Claude Code is not installed. Install it from https://claude.com/claude-code, sign in with your subscription, then retry.",
      );
    }
    if (!cli.versionSupported) {
      return failure(
        "unsupported-version",
        `Claude Code ${cli.version ?? "(unknown version)"} is not supported; Dyad requires ${MIN_SUPPORTED_CLAUDE_CODE_VERSION} or newer. Update Claude Code and retry.`,
      );
    }
    const auth = await getAuth(cli.executablePath);
    if (auth.state === "unauthenticated") {
      return failure(
        "unauthenticated",
        "Claude Code is not signed in. Run `claude` in a terminal, sign in with /login, then retry.",
      );
    }

    if (context.signal.aborted) {
      return {
        status: "cancelled",
        sessionId: input.sessionId,
        resolvedModel: null,
        usage: null,
        finalText: "",
      };
    }

    const bridgeToolNames = getBridgeToolNamesForMode(input.mode);
    const systemPromptAppendix =
      this.deps.systemPromptAppendix ??
      buildClaudeCodeSystemPromptAppendix({
        mode: input.mode,
        appInstructions: input.appInstructions,
        bridgeToolNames,
        appPath: input.appPath,
      });
    const files = await writeTurnFiles(input, systemPromptAppendix);

    const state: TurnState = {
      sessionId: input.sessionId,
      resolvedModel: null,
      finalText: "",
      result: null,
      syntheticError: null,
      apiKeyBillingRefusal: null,
      requestTerminate: null,
      usageLimitHit: false,
      textBlocksStreamed: new Set(),
      toolNamesByCallId: new Map(),
      toolBlocksByIndex: new Map(),
      lastStreamedMessageId: null,
    };

    const emit = context.emit;
    const bridgeBase = this.deps.createBridgeContext(context.signal, emit);
    const bridgeContext: DyadMcpBridgeContext = {
      ...bridgeBase,
      mode: input.mode,
      signal: context.signal,
    };

    const onEvent = (event: CliEvent) => {
      this.handleEvent(event, state, input, emit);
    };

    const args = buildClaudeCodeCliArgs({
      mode: input.mode,
      model: input.requestedModel,
      effortLevel: input.effortLevel,
      resumeSessionId: input.sessionId,
      newSessionId: input.sessionId ? null : input.newSessionId,
      appendSystemPromptFile: files.systemPromptFile,
      mcpConfigFile: files.mcpConfigFile,
    });

    let process_: ClaudeCliProcess;
    const spawnProcess = this.deps.spawnProcess ?? ClaudeCliProcess.spawn;
    try {
      process_ = spawnProcess({
        executablePath: cli.executablePath,
        args,
        cwd: input.appPath,
        env: buildClaudeCliEnvironment(),
        handlers: {
          onEvent,
          onCanUseTool: async (request) => {
            const decision = decideToolPermission({
              toolName: request.tool_name,
              input: request.input,
              mode: input.mode,
              appPath: input.appPath,
              consents: this.deps.consents,
            });
            if (decision.kind === "allow") {
              return { behavior: "allow", updatedInput: request.input };
            }
            if (decision.kind === "deny") {
              emit({
                type: "tool-denied",
                toolName: request.tool_name,
                reason: decision.reason,
              });
              return { behavior: "deny", message: decision.reason };
            }
            const approval = await context.requestApproval({
              toolName: request.tool_name,
              consentToolName: decision.consentToolName,
              description: decision.description,
              inputPreview: decision.inputPreview,
              input: request.input,
            });
            if (approval.behavior === "allow") {
              return { behavior: "allow", updatedInput: request.input };
            }
            emit({
              type: "tool-denied",
              toolName: request.tool_name,
              reason: approval.message,
            });
            return { behavior: "deny", message: approval.message };
          },
          onMcpMessage: async (request) => {
            if (request.server_name !== CLAUDE_CODE_MCP_SERVER_NAME) {
              return {
                jsonrpc: "2.0",
                id: request.message.id ?? null,
                error: {
                  code: -32601,
                  message: `Unknown MCP server ${request.server_name}`,
                },
              };
            }
            return handleDyadMcpMessage(request.message, bridgeContext);
          },
          onStderr: (text) => {
            logger.debug(`[claude stderr] ${text.trimEnd()}`);
          },
        },
      });
    } catch (error) {
      await cleanupTurnFiles(files.dir);
      return failure(
        "spawn-failed",
        `Could not start Claude Code: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const onAbort = () => {
      void process_.terminate();
    };
    context.signal.addEventListener("abort", onAbort, { once: true });
    state.requestTerminate = () => {
      void process_.terminate({ interruptGraceMs: 500, termGraceMs: 1_000 });
    };

    try {
      process_.sendUserMessage(
        buildClaudeCodeUserMessage({
          prompt: input.prompt,
          attachments: input.attachments,
        }),
      );

      const exit = await this.awaitCompletion(process_, state);
      const usage = state.result
        ? normalizeCliResultUsage(state.result, {
            primaryModel: state.resolvedModel,
          })
        : null;

      if (exit.spawnError) {
        return {
          ...failure(
            "spawn-failed",
            `Could not start Claude Code: ${exit.spawnError.message}`,
          ),
          sessionId: state.sessionId,
          usage,
        };
      }

      if (context.signal.aborted) {
        return {
          status: "cancelled",
          sessionId: state.sessionId,
          resolvedModel: state.resolvedModel,
          usage,
          finalText: state.finalText,
        };
      }

      const classified = classifyFailure(state, exit);
      if (classified) {
        return {
          status: "error",
          sessionId: state.sessionId,
          resolvedModel: state.resolvedModel,
          usage,
          finalText: state.finalText,
          error: classified,
        };
      }

      return {
        status: "completed",
        sessionId: state.sessionId,
        resolvedModel: state.resolvedModel,
        usage,
        finalText: state.finalText,
      };
    } finally {
      context.signal.removeEventListener("abort", onAbort);
      if (!process_.hasExited) {
        await process_.terminate({
          interruptGraceMs: 1_000,
          termGraceMs: 1_000,
        });
      }
      await cleanupTurnFiles(files.dir);
    }
  }

  private async awaitCompletion(
    process_: ClaudeCliProcess,
    state: TurnState,
  ): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
    spawnError: Error | null;
  }> {
    // The CLI stays alive while stdin is open (it waits for more user
    // messages). Close stdin after the result event so it exits, but give it
    // a bounded grace period.
    const resultSeen = new Promise<void>((resolve) => {
      const check = () => {
        if (state.result || process_.hasExited) {
          resolve();
          return;
        }
        setTimeout(check, 25);
      };
      check();
    });
    await Promise.race([resultSeen, process_.exited]);
    process_.closeStdin();
    const exit = await Promise.race([
      process_.exited,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), RESULT_EXIT_GRACE_MS),
      ),
    ]);
    if (exit) {
      return exit;
    }
    logger.warn("Claude Code did not exit after its result event; terminating");
    await process_.terminate({ interruptGraceMs: 500, termGraceMs: 1_000 });
    return process_.exited;
  }

  private handleEvent(
    event: CliEvent,
    state: TurnState,
    input: ChatBackendTurnInput,
    emit: (event: ChatBackendEvent) => void,
  ): void {
    switch (event.type) {
      case "system": {
        if (event.subtype === "init") {
          const init = event as Extract<CliEvent, { subtype: "init" }>;
          if (init.apiKeySource && init.apiKeySource !== "none") {
            // Never run on API-key billing: stop the turn before any model
            // call can be billed to an API key and fail loudly.
            state.apiKeyBillingRefusal = `Claude Code is authenticating with an API key (${init.apiKeySource}) instead of your subscription. Dyad refuses to run subscription-backed turns on API billing; remove the API key from Claude Code's environment and retry.`;
            state.requestTerminate?.();
            return;
          }
          state.sessionId = init.session_id;
          emit({
            type: "session-started",
            sessionId: init.session_id,
            resumed: input.sessionId !== null,
          });
        }
        return;
      }
      case "rate_limit_event": {
        const info = event.rate_limit_info;
        if (info && info.status && info.status !== "allowed") {
          state.usageLimitHit = true;
          emit({
            type: "rate-limit",
            message: `Claude subscription limit (${info.rateLimitType ?? "unknown"}) reached${
              info.resetsAt
                ? `; resets at ${new Date(info.resetsAt * 1000).toLocaleString()}`
                : ""
            }.`,
          });
        }
        return;
      }
      case "stream_event": {
        if (event.parent_tool_use_id) {
          return; // subagent output is never surfaced as the root response
        }
        const streamEvent = event.event;
        if (streamEvent.type === "message_start") {
          const model = streamEvent.message?.model;
          if (model && model !== SYNTHETIC_MODEL && !state.resolvedModel) {
            state.resolvedModel = model;
            emit({ type: "model-resolved", model });
          }
          state.toolBlocksByIndex.clear();
          return;
        }
        if (
          streamEvent.type === "content_block_start" &&
          streamEvent.content_block?.type === "tool_use" &&
          streamEvent.index !== undefined &&
          streamEvent.content_block.id &&
          streamEvent.content_block.name
        ) {
          state.toolBlocksByIndex.set(streamEvent.index, {
            id: streamEvent.content_block.id,
            name: streamEvent.content_block.name,
          });
          return;
        }
        if (
          streamEvent.type === "content_block_delta" &&
          streamEvent.delta?.type === "text_delta" &&
          typeof streamEvent.delta.text === "string"
        ) {
          state.finalText += streamEvent.delta.text;
          emit({ type: "text-delta", text: streamEvent.delta.text });
          if (streamEvent.index !== undefined) {
            state.textBlocksStreamed.add(
              `${state.lastStreamedMessageId ?? "current"}:${streamEvent.index}`,
            );
          }
        }
        return;
      }
      case "assistant": {
        if (event.parent_tool_use_id) {
          return;
        }
        const message = event.message;
        const model = message.model;
        if (model === SYNTHETIC_MODEL) {
          const text = message.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("\n")
            .trim();
          if (text) {
            state.syntheticError = text;
          }
          return;
        }
        if (model && !state.resolvedModel) {
          state.resolvedModel = model;
          emit({ type: "model-resolved", model });
        }
        for (const block of message.content) {
          if (block.type === "tool_use") {
            state.toolNamesByCallId.set(block.id, block.name);
            emit({
              type: "tool-start",
              toolCallId: block.id,
              toolName: block.name,
              input: block.input,
            });
          } else if (block.type === "text") {
            // Text was already streamed through partial deltas whenever the
            // CLI emitted them; only fall back to the complete block when no
            // delta for this message arrived (older CLIs or non-streaming).
            if (state.textBlocksStreamed.size === 0 && block.text) {
              state.finalText += block.text;
              emit({ type: "text-delta", text: block.text });
            }
          }
        }
        state.textBlocksStreamed.clear();
        return;
      }
      case "user": {
        if (event.parent_tool_use_id) {
          return;
        }
        const content = event.message.content;
        if (typeof content === "string") {
          return;
        }
        for (const block of content) {
          if (block.type === "tool_result") {
            const toolName =
              state.toolNamesByCallId.get(block.tool_use_id) ?? "tool";
            emit({
              type: "tool-result",
              toolCallId: block.tool_use_id,
              toolName,
              output: toolResultText(block.content),
              isError: block.is_error === true,
            });
          }
        }
        return;
      }
      case "result": {
        if (state.apiKeyBillingRefusal) {
          return;
        }
        state.result = event;
        if (event.session_id && !state.sessionId) {
          state.sessionId = event.session_id;
        }
        return;
      }
      default:
        return;
    }
  }
}

async function cleanupTurnFiles(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (error) {
    logger.debug(`Failed to remove Claude Code turn files at ${dir}`, error);
  }
}

export type { ChatBackendTurnUsage };
