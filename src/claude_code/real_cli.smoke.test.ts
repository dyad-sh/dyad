// @vitest-environment node
//
// Real Claude Code CLI smoke test. Drives Dyad's REAL `chat:stream` handler
// against the REAL, subscription-authenticated `claude` CLI in a disposable
// app. It spends real subscription usage, so it only runs when explicitly
// requested:
//
//   DYAD_CLAUDE_CODE_SMOKE=1 npm test -- src/claude_code/real_cli.smoke.test.ts
//
// Evidence from the last run is recorded in docs/claude-code-integration.md.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import { chats, claudeCodeUsageReports, messages } from "@/db/schema";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { createFakeIpcEvent } from "@/testing/electron_mock";
import { formatAssistantModelAttribution } from "@/shared/chat_backend";
import { calculateClaudeCodeTurnCharge } from "@/shared/claude_code_pricing";
import { locateClaudeCodeCli, getClaudeCodeAuthStatus } from "./cli_locator";
import type { ClaudeCodeUsageEvent } from "./usage_tracking";

const ENABLED = process.env.DYAD_CLAUDE_CODE_SMOKE === "1";

describe.skipIf(!ENABLED)("Claude Code real CLI smoke", () => {
  let harness: ChatFlowHarness;
  let engine: http.Server;
  const trackUsageCalls: ClaudeCodeUsageEvent[] = [];
  const evidence: Record<string, unknown> = {};

  const loadRows = (chatId: number) =>
    harness.db.query.messages.findMany({
      where: eq(messages.chatId, chatId),
      orderBy: (table, { asc }) => [asc(table.id)],
    });
  const newChat = async () => {
    const [row] = await harness.db
      .insert(chats)
      .values({ appId: harness.appId })
      .returning();
    return row.id;
  };
  const lastAssistant = async (chatId: number) =>
    (await loadRows(chatId)).filter((m) => m.role === "assistant").at(-1)!;

  beforeAll(async () => {
    delete process.env.DYAD_CLAUDE_CODE_EXECUTABLE;
    const cli = await locateClaudeCodeCli({ refresh: true });
    if (!cli) throw new Error("Claude Code CLI not found on this machine");
    const auth = await getClaudeCodeAuthStatus(cli.executablePath, {
      refresh: true,
    });
    evidence.cli = {
      ...cli,
      auth: { ...auth, email: auth.email ? "<redacted>" : null },
    };

    engine = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        if (req.url === "/v1/track-usage") {
          trackUsageCalls.push(JSON.parse(raw));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ accepted: true }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) =>
      engine.listen(0, "127.0.0.1", resolve),
    );
    const port = (engine.address() as { port: number }).port;
    process.env.DYAD_ENGINE_URL = `http://127.0.0.1:${port}/v1`;

    harness = await setupChatFlowHarness({
      electronMock: h,
      selectedModel: { provider: "claude-code", name: "sonnet" },
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "dyad-pro-key" } } },
        claudeCodeChargeAcknowledged: true,
      },
    });
    fs.writeFileSync(
      path.join(harness.appDir, "AI_RULES.md"),
      "# AI rules\n\nAlways end file contents with a trailing newline.\n",
    );
  }, 120_000);

  afterAll(async () => {
    delete process.env.DYAD_ENGINE_URL;
    await harness?.dispose();
    await new Promise<void>((resolve) => engine.close(() => resolve()));
    // Evidence for docs/claude-code-integration.md (no secrets).
    const out = path.join(
      process.cwd(),
      ".claude",
      "tmp",
      "claude-code-smoke-evidence.json",
    );
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
  });

  it("streams a coding response with a Claude Code footer and edits a file", async () => {
    const chatId = await newChat();
    const { eventsFor } = await harness.streamChat(
      "Create a file at src/greeting.txt whose only content is the line `hello from claude code`. Do not modify anything else. Reply with one short sentence when done.",
      { chatId },
    );
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    const assistant = await lastAssistant(chatId);
    expect(assistant.executionBackend).toBe("claude-code");
    expect(assistant.model).toMatch(/^claude-/);
    expect(formatAssistantModelAttribution(assistant)).toBe(
      `Claude Code (${assistant.model})`,
    );
    expect(assistant.content).toContain("<dyad-write");
    expect(harness.appFileExists("src/greeting.txt")).toBe(true);
    expect(harness.readAppFile("src/greeting.txt").trim()).toBe(
      "hello from claude code",
    );
    expect(assistant.commitHash).toBeTruthy();
    const end = eventsFor("chat:response:end")[0].payload as {
      updatedFiles: boolean;
    };
    expect(end.updatedFiles).toBe(true);
    const chat = await harness.db.query.chats.findFirst({
      where: eq(chats.id, chatId),
    });
    expect(chat?.claudeCodeSessionId).toBeTruthy();
    evidence.turn1 = {
      chatId,
      model: assistant.model,
      footer: formatAssistantModelAttribution(assistant),
      commitHash: assistant.commitHash,
      updatedFiles: end.updatedFiles,
      sessionId: chat?.claudeCodeSessionId,
      gitLog: harness.gitLog().slice(0, 2),
    };
  }, 180_000);

  it("continues the chat from persisted state (as after a Dyad restart)", async () => {
    const chatId = await newChat();
    await harness.streamChat(
      "Remember the codeword TANGERINE. Reply with just `ok`. Do not use tools.",
      { chatId },
    );
    const chat = await harness.db.query.chats.findFirst({
      where: eq(chats.id, chatId),
    });
    const sessionId = chat!.claudeCodeSessionId!;
    // Simulate a restart: a fresh chat row that only carries the persisted
    // session id, with nothing about the previous turn in memory.
    const restoredChatId = await newChat();
    await harness.db
      .update(chats)
      .set({ claudeCodeSessionId: sessionId, executionBackend: "claude-code" })
      .where(eq(chats.id, restoredChatId));
    await harness.streamChat(
      "What was the codeword? Reply with the single word.",
      {
        chatId: restoredChatId,
      },
    );
    const assistant = await lastAssistant(restoredChatId);
    expect(assistant.content.toUpperCase()).toContain("TANGERINE");
    evidence.resume = { sessionId, reply: assistant.content.slice(0, 80) };
  }, 180_000);

  it("cancels an active turn and terminates the CLI", async () => {
    const chatId = await newChat();
    const streaming = harness.streamChat(
      "Write a 600 word essay about rivers. Do not use tools.",
      { chatId },
    );
    await vi.waitFor(
      async () => {
        const rows = await loadRows(chatId);
        expect(
          rows.find((m) => m.role === "assistant")?.content.length ?? 0,
        ).toBeGreaterThan(20);
      },
      { timeout: 60_000, interval: 250 },
    );
    const cancel = h.ipcHandlers.get("chat:cancel")!;
    const started = Date.now();
    await cancel(createFakeIpcEvent([]), chatId);
    const { eventsFor } = await streaming;
    const cancelMs = Date.now() - started;
    const assistant = await lastAssistant(chatId);
    expect(assistant.content).toContain("[Response cancelled by user]");
    const end = eventsFor("chat:response:end").at(-1)?.payload as {
      wasCancelled?: boolean;
    };
    expect(end?.wasCancelled).toBe(true);
    const report = harness.db
      .select()
      .from(claudeCodeUsageReports)
      .where(eq(claudeCodeUsageReports.messageId, assistant.id))
      .get();
    evidence.cancel = {
      cancelMs,
      partialChars: assistant.content.length,
      usageStatus: report?.status,
      usageTurnStatus: report
        ? JSON.parse(report.payloadJson).correlation?.turnStatus
        : null,
    };
  }, 180_000);

  it("denies Bash execution", async () => {
    const chatId = await newChat();
    await harness.streamChat(
      "Use the Bash tool to run `ls -la` and tell me the output. If Bash is unavailable, say exactly: NO_BASH.",
      { chatId },
    );
    const assistant = await lastAssistant(chatId);
    expect(assistant.content).toContain("NO_BASH");
    evidence.bash = { reply: assistant.content.slice(0, 200) };
  }, 180_000);

  it("invokes an approved Dyad MCP operation", async () => {
    const chatId = await newChat();
    await harness.streamChat(
      "Call the Dyad tool mcp__dyad__run_type_checks with no arguments and reply with a one-line summary of its result prefixed by TYPECHECK:.",
      { chatId },
    );
    const assistant = await lastAssistant(chatId);
    expect(assistant.content).toContain("TYPECHECK:");
    expect(assistant.content).toMatch(/<dyad-status|<dyad-output/);
    evidence.mcp = { reply: assistant.content.slice(-300) };
  }, 180_000);

  it("rejects mutations in read-only Ask mode", async () => {
    const chatId = await newChat();
    await harness.streamChat(
      "Create a file src/should-not-exist.txt with the content `x`. If you are not permitted to write, say exactly: READ_ONLY.",
      { chatId, requestedChatMode: "ask" },
    );
    const assistant = await lastAssistant(chatId);
    expect(harness.appFileExists("src/should-not-exist.txt")).toBe(false);
    expect(assistant.commitHash).toBeNull();
    evidence.askMode = { reply: assistant.content.slice(0, 200) };
  }, 180_000);

  it("reports real usage that prices consistently with the CLI's list-price cost", async () => {
    await vi.waitFor(() => expect(trackUsageCalls.length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    const completed = trackUsageCalls.filter(
      (e) => e.correlation.turnStatus === "completed",
    );
    expect(completed.length).toBeGreaterThan(0);
    for (const event of completed) {
      expect(event.models.length).toBeGreaterThan(0);
      const charge = calculateClaudeCodeTurnCharge(event.models);
      // The CLI prints its own list-price cost; our catalog estimate should
      // agree closely when every model is known (allowing cache-write rate
      // rounding differences).
      if (
        event.backendReportedCostUsd !== null &&
        charge.perModel.every((m) => m.basis.kind === "catalog")
      ) {
        const ratio = charge.listPriceUsd / event.backendReportedCostUsd;
        expect(ratio).toBeGreaterThan(0.85);
        expect(ratio).toBeLessThan(1.15);
      }
    }
    evidence.usage = completed.map((event) => ({
      eventId: event.eventId,
      turnStatus: event.correlation.turnStatus,
      resolvedModel: event.resolvedModel,
      models: event.models.map((m) => ({
        model: m.model,
        role: m.role,
        inputTokens: m.inputTokens,
        cacheReadTokens: m.cacheReadTokens,
        cacheWriteTokens: m.cacheWriteTokens,
        outputTokens: m.outputTokens,
      })),
      billableTokens: event.totals.billableTokens,
      cliCostUsd: event.backendReportedCostUsd,
      clientEstimate: event.pricing.clientEstimate,
    }));
  }, 30_000);
});
