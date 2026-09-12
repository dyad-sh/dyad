// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));
vi.mock("@/main/settings", () => ({ readSettings: () => ({}) }));
vi.mock("fix-path", () => ({ default: () => {} }));
// The bridge pulls in main-process services; the runner tests only need the
// JSON-RPC surface, so stub the heavy dependencies.
vi.mock("@/ipc/services/app_operation_coordinator", () => ({
  appOperationCoordinator: {
    run: async (_r: unknown, fn: () => unknown) => fn(),
  },
  readAppResource: (resource: string) => ({ resource, access: "read" }),
}));
vi.mock("@/ipc/services/app_run_actor_service", () => ({
  appRunActorService: { executeExternalLifecycle: vi.fn() },
}));
vi.mock("@/ipc/processors/executeAddDependency", () => ({
  installPackages: vi.fn(),
  ExecuteAddDependencyError: class extends Error {},
}));
vi.mock("@/ipc/processors/tsc", () => ({ runTypeScriptCheck: vi.fn() }));
vi.mock("@/ipc/handlers/tests_handlers", () => ({
  runAppTestsWithIsolation: vi.fn(),
}));
vi.mock("@/ipc/utils/window_broadcast", () => ({
  broadcastToRegisteredWindows: vi.fn(),
}));
vi.mock("@/lib/log_store", () => ({ getLogs: () => [] }));

import type {
  ChatBackendApprovalRequest,
  ChatBackendEvent,
  ChatBackendTurnInput,
} from "@/chat_backend/backend";
import { ClaudeCliProcess } from "./cli_process";
import { ClaudeCodeTurnRunner } from "./turn_runner";

const FAKE_CLI = path.resolve(__dirname, "testing", "fake_claude_cli.mjs");

function makeRunner(
  options: {
    consents?: Record<string, "ask" | "always" | "never">;
    env?: Record<string, string>;
    authLoggedIn?: boolean;
  } = {},
) {
  return new ClaudeCodeTurnRunner({
    consents: options.consents,
    locateCli: async () => ({
      executablePath: process.execPath,
      version: "2.1.260",
      versionSupported: true,
      source: "env",
    }),
    getAuthStatus: async () => ({
      state:
        options.authLoggedIn === false ? "unauthenticated" : "authenticated",
      method: "claude.ai",
      subscriptionType: "max",
      email: null,
      detail: null,
    }),
    spawnProcess: (spawnOptions) =>
      ClaudeCliProcess.spawn({
        ...spawnOptions,
        executablePath: process.execPath,
        args: [FAKE_CLI, ...spawnOptions.args],
        env: { ...spawnOptions.env, ...options.env },
      }),
    createBridgeContext: () => ({
      event: { sender: { id: 1 } } as never,
      appId: 1,
      appPath: appDir,
      chatId: 1,
      testingEnabled: false,
      onToolCard: (xml) => cards.push(xml),
      onWarning: (message) => warnings.push(message),
    }),
  });
}

let appDir: string;
let cards: string[];
let warnings: string[];

function input(
  overrides: Partial<ChatBackendTurnInput> = {},
): ChatBackendTurnInput {
  return {
    chatId: 1,
    appId: 1,
    appPath: appDir,
    mode: "agent",
    requestedModel: "sonnet",
    effortLevel: "high",
    prompt: "[scenario:write-file] make a file",
    attachments: [],
    appInstructions: "Always use TypeScript.",
    sessionId: null,
    newSessionId: "11111111-1111-4111-8111-111111111111",
    usageEventId: "usage-1",
    ...overrides,
  };
}

async function run(
  runner: ClaudeCodeTurnRunner,
  turnInput: ChatBackendTurnInput,
  options: {
    approve?: (request: ChatBackendApprovalRequest) => boolean;
    controller?: AbortController;
  } = {},
) {
  const events: ChatBackendEvent[] = [];
  const controller = options.controller ?? new AbortController();
  const result = await runner.runTurn(turnInput, {
    signal: controller.signal,
    emit: (event) => events.push(event),
    requestApproval: async (request) =>
      (options.approve?.(request) ?? true)
        ? { behavior: "allow" }
        : { behavior: "deny", message: "declined" },
  });
  return { result, events };
}

describe("ClaudeCodeTurnRunner (fake CLI)", () => {
  beforeEach(() => {
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-claude-runner-"));
    cards = [];
    warnings = [];
    delete process.env.FAKE_CLAUDE_LOG;
  });
  afterEach(() => {
    fs.rmSync(appDir, { recursive: true, force: true });
  });

  it("streams text, allows an in-app Write, and reports per-model usage", async () => {
    const log = path.join(appDir, "invocations.log");
    const runner = makeRunner({ env: { FAKE_CLAUDE_LOG: log } });
    const { result, events } = await run(runner, input());

    expect(result.status).toBe("completed");
    expect(result.sessionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.resolvedModel).toBe("claude-sonnet-5");
    expect(result.finalText).toContain("Creating the file now.");
    expect(result.finalText).toContain("Done.");
    expect(
      fs.readFileSync(path.join(appDir, "src", "claude-created.txt"), "utf8"),
    ).toBe("hello from claude\n");
    expect(events.some((e) => e.type === "session-started" && !e.resumed)).toBe(
      true,
    );
    expect(
      events.some(
        (e) => e.type === "model-resolved" && e.model === "claude-sonnet-5",
      ),
    ).toBe(true);
    expect(
      events.filter((e) => e.type === "text-delta").length,
    ).toBeGreaterThan(1);
    expect(events.find((e) => e.type === "tool-start")).toMatchObject({
      toolName: "Write",
    });
    expect(events.find((e) => e.type === "tool-result")).toMatchObject({
      toolName: "Write",
      isError: false,
    });
    expect(result.usage?.perModel.map((m) => m.model).sort()).toEqual([
      "claude-haiku-4-5-20251001",
      "claude-sonnet-5",
    ]);
    expect(result.usage?.backendReportedCostUsd).toBeCloseTo(0.0625072, 6);

    const invocation = JSON.parse(
      fs.readFileSync(log, "utf8").trim().split("\n").at(-1)!,
    );
    expect(invocation.argv).toContain("--restricted");
    expect(invocation.argv).toContain("--strict-mcp-config");
    expect(invocation.argv[invocation.argv.indexOf("--tools") + 1]).toBe(
      "Read,Glob,Grep,Edit,Write",
    );
    expect(invocation.argv[invocation.argv.indexOf("--session-id") + 1]).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(invocation.argv).not.toContain("--resume");
    expect(invocation.cwd).toBe(fs.realpathSync(appDir));
    expect(invocation.hasAnthropicApiKey).toBe(false);
    expect(invocation.systemPromptAppendix).toContain("Always use TypeScript.");
    expect(invocation.systemPromptAppendix).toContain(
      "mcp__dyad__add_dependency",
    );
  });

  it("resumes only the chat's explicit session id", async () => {
    const log = path.join(appDir, "invocations.log");
    const runner = makeRunner({ env: { FAKE_CLAUDE_LOG: log } });
    const { result } = await run(
      runner,
      input({
        prompt: "[scenario:resume-check] continue",
        sessionId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe(
      "resumed:22222222-2222-4222-8222-222222222222",
    );
    const invocation = JSON.parse(
      fs.readFileSync(log, "utf8").trim().split("\n").at(-1)!,
    );
    expect(invocation.argv[invocation.argv.indexOf("--resume") + 1]).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(invocation.argv).not.toContain("--continue");
    expect(invocation.argv).not.toContain("--session-id");
  });

  it("denies Bash even when the CLI asks for it", async () => {
    const { result, events } = await run(
      makeRunner(),
      input({ prompt: "[scenario:bash] run ls" }),
    );
    expect(result.status).toBe("completed");
    expect(result.finalText).toContain("Bash deny");
    expect(events.find((e) => e.type === "tool-denied")).toMatchObject({
      toolName: "Bash",
    });
  });

  it("denies file writes in Ask mode with a read-only reason", async () => {
    const { result } = await run(
      makeRunner(),
      input({ mode: "ask", prompt: "[scenario:edit-attempt] edit" }),
    );
    expect(result.status).toBe("completed");
    expect(result.finalText).toContain("Write deny");
    expect(result.finalText).toContain("read-only");
    expect(fs.existsSync(path.join(appDir, "src", "ask-mode.txt"))).toBe(false);
  });

  it("routes ask-consent tools through the approval callback", async () => {
    const seen: ChatBackendApprovalRequest[] = [];
    const denied = await run(
      makeRunner(),
      input({ prompt: "[scenario:mcp-add-dependency] add" }),
      {
        approve: (request) => {
          seen.push(request);
          return false;
        },
      },
    );
    expect(seen[0]).toMatchObject({
      toolName: "mcp__dyad__add_dependency",
      consentToolName: "add_dependency",
      inputPreview: "Install or refresh left-pad",
    });
    expect(denied.result.finalText).toContain("add_dependency deny");

    const allowed = await run(
      makeRunner({ consents: { add_dependency: "always" } }),
      input({ prompt: "[scenario:mcp-add-dependency] add" }),
      { approve: () => false },
    );
    expect(allowed.result.finalText).toContain("add_dependency allow");
  });

  it("serves the Dyad MCP bridge over the control channel", async () => {
    const { result, events } = await run(
      makeRunner(),
      input({ prompt: "[scenario:mcp-read-logs] logs" }),
    );
    expect(result.status).toBe("completed");
    expect(result.finalText).toContain("server:dyad");
    expect(result.finalText).toContain(
      "tools:add_dependency|run_type_checks|run_tests|read_logs|restart_app",
    );
    expect(result.finalText).toContain("logs:No logs found");
    expect(cards.some((xml) => xml.startsWith("<dyad-read-logs"))).toBe(true);
    expect(events.find((e) => e.type === "tool-start")).toMatchObject({
      toolName: "mcp__dyad__read_logs",
    });
  });

  it("validates bridge arguments and rejects unknown bridge tools", async () => {
    const { result } = await run(
      makeRunner(),
      input({ prompt: "[scenario:mcp-bad-args] x" }),
    );
    expect(result.finalText).toContain("bad-args isError:true");
    expect(result.finalText).toContain("unknown:-32602");
  });

  it("classifies a signed-out CLI", async () => {
    const { result } = await run(
      makeRunner(),
      input({ prompt: "[scenario:not-logged-in] hi" }),
    );
    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("unauthenticated");
    expect(result.usage).toBeNull();
  });

  it("classifies a missing session instead of silently starting a new one", async () => {
    const { result } = await run(
      makeRunner(),
      input({
        prompt: "[scenario:session-missing] hi",
        sessionId: "00000000-0000-4000-8000-000000000000",
      }),
    );
    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("session-not-found");
    expect(result.error?.message).toContain("Start a new chat");
  });

  it("classifies a crash before the result event", async () => {
    const { result } = await run(
      makeRunner(),
      input({ prompt: "[scenario:crash] x" }),
    );
    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("crashed");
    expect(result.finalText).toContain("About to crash");
    expect(result.usage).toBeNull();
  });

  it("refuses to run when the CLI would bill an API key", async () => {
    const { result } = await run(
      makeRunner({ env: { FAKE_CLAUDE_API_KEY_SOURCE: "ANTHROPIC_API_KEY" } }),
      input(),
    );
    expect(result.status).toBe("error");
    expect(result.error?.message).toContain("API key");
    expect(fs.existsSync(path.join(appDir, "src", "claude-created.txt"))).toBe(
      false,
    );
  });

  it("cancels an active turn, terminates the process, and keeps reported usage", async () => {
    const log = path.join(appDir, "invocations.log");
    const runner = makeRunner({ env: { FAKE_CLAUDE_LOG: log } });
    const controller = new AbortController();
    const pending = run(runner, input({ prompt: "[scenario:slow] essay" }), {
      controller,
    });
    await vi.waitFor(() => {
      expect(fs.existsSync(log)).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    controller.abort();
    const { result } = await pending;
    expect(result.status).toBe("cancelled");
    expect(result.finalText.length).toBeGreaterThan(0);
    const lines = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.some((line) => line.interrupted)).toBe(true);
    // Usage flushed by the CLI on interrupt is still captured for billing.
    expect(result.usage?.perModel.length).toBeGreaterThan(0);
  }, 20_000);

  it("reports usage for models the pricing catalog does not know", async () => {
    const { result } = await run(
      makeRunner(),
      input({ prompt: "[scenario:unknown-model] hi" }),
    );
    expect(result.status).toBe("completed");
    expect(result.usage?.perModel).toEqual([
      expect.objectContaining({
        model: "claude-mystery-9",
        inputTokens: 1000,
        outputTokens: 500,
      }),
    ]);
  });

  it("fails fast when the CLI is signed out according to auth status", async () => {
    const { result } = await run(makeRunner({ authLoggedIn: false }), input());
    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("unauthenticated");
  });
});
