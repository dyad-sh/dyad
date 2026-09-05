// @vitest-environment node
//
// End-to-end coverage of the Claude Code (Subscription) backend through the
// REAL `chat:stream` handler: turn admission, backend latching, streaming
// chunks, tool cards, permission enforcement, session isolation/resumption,
// checkpoints, cancellation, and usage reporting — driven by a deterministic
// fake CLI that speaks the exact stream-json protocol.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
import { flushPendingClaudeCodeUsageReports } from "./usage_tracking";

const FAKE_CLI = path.resolve(__dirname, "testing", "fake_claude_cli.mjs");

interface TrackUsageCall {
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

describe.skipIf(process.platform === "win32")(
  "Claude Code backend chat flow",
  () => {
    let harness: ChatFlowHarness;
    let engine: http.Server;
    let engineUrl: string;
    let engineStatus = 200;
    const trackUsageCalls: TrackUsageCall[] = [];
    let invocationLog: string;

    beforeAll(async () => {
      engine = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          if (req.url === "/v1/track-usage") {
            trackUsageCalls.push({
              headers: req.headers,
              body: JSON.parse(raw),
            });
            res.writeHead(engineStatus, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ accepted: true, chargedUsd: 0.0159 }));
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
      engineUrl = `http://127.0.0.1:${port}/v1`;
      process.env.DYAD_ENGINE_URL = engineUrl;
      process.env.DYAD_CLAUDE_CODE_EXECUTABLE = FAKE_CLI;

      harness = await setupChatFlowHarness({
        electronMock: h,
        selectedModel: { provider: "claude-code", name: "sonnet" },
        chatMode: "local-agent",
        settings: {
          enableDyadPro: true,
          providerSettings: { auto: { apiKey: { value: "dyad-pro-key" } } },
          claudeCodeChargeAcknowledged: true,
          agentToolConsents: { add_dependency: "ask" },
        },
      });
      invocationLog = path.join(harness.userDataDir, "fake-claude.log");
      process.env.FAKE_CLAUDE_LOG = invocationLog;
    }, 60_000);

    afterAll(async () => {
      delete process.env.DYAD_CLAUDE_CODE_EXECUTABLE;
      delete process.env.FAKE_CLAUDE_LOG;
      delete process.env.DYAD_ENGINE_URL;
      await harness?.dispose();
      await new Promise<void>((resolve) => engine.close(() => resolve()));
    });

    beforeEach(() => {
      engineStatus = 200;
      trackUsageCalls.length = 0;
    });

    const readInvocations = () =>
      fs.existsSync(invocationLog)
        ? fs
            .readFileSync(invocationLog, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>)
        : [];

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

    it("streams a subscription turn: attribution, session, checkpoint, preview, usage", async () => {
      const chatId = await newChat();
      const { events, eventsFor } = await harness.streamChat(
        "[scenario:write-file] create a file",
        { chatId },
      );
      const rows = await loadRows(chatId);

      expect(eventsFor("chat:response:error")).toHaveLength(0);
      const assistant = rows.find((m) => m.role === "assistant")!;
      expect(assistant.executionBackend).toBe("claude-code");
      expect(assistant.model).toBe("claude-sonnet-5");
      expect(assistant.approvalState).toBe("approved");
      expect(assistant.content).toContain("Creating the file now.");
      expect(assistant.content).toContain(
        '<dyad-write path="src/claude-created.txt"',
      );
      expect(assistant.content).toContain("Done.");
      expect(assistant.commitHash).toBeTruthy();
      expect(harness.readAppFile("src/claude-created.txt")).toBe(
        "hello from claude\n",
      );
      expect(harness.gitLog()[0]).toContain("create a file");

      const chat = await harness.db.query.chats.findFirst({
        where: eq(chats.id, chatId),
      });
      expect(chat?.executionBackend).toBe("claude-code");
      expect(chat?.claudeCodeSessionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(chat?.title).toBe("[scenario:write-file] create a file");

      const channels = events.map((e) => e.channel);
      expect(channels).toContain("chat:stream:start");
      expect(
        channels.filter((c) => c === "chat:response:chunk").length,
      ).toBeGreaterThan(2);
      const end = eventsFor("chat:response:end")[0].payload as {
        updatedFiles: boolean;
      };
      expect(end.updatedFiles).toBe(true);
      expect(channels).toContain("chat:stream:end");

      // Attribution reaches the renderer with the persisted backend.
      const lastChunk = eventsFor("chat:response:chunk")
        .map(
          (e) =>
            e.payload as {
              messages?: Array<{ executionBackend?: string; model?: string }>;
            },
        )
        .filter((p) => p.messages)
        .at(-1)!;
      expect(lastChunk.messages!.at(-1)).toMatchObject({
        executionBackend: "claude-code",
        model: "claude-sonnet-5",
      });

      // Usage reported to the engine with normalized token categories.
      await vi.waitFor(() => expect(trackUsageCalls).toHaveLength(1), {
        timeout: 5_000,
      });
      const call = trackUsageCalls[0];
      expect(call.headers.authorization).toBe("Bearer dyad-pro-key");
      expect(call.body).toMatchObject({
        backend: "claude-code",
        correlation: {
          chatId,
          messageId: assistant.id,
          appId: harness.appId,
          turnStatus: "completed",
        },
        resolvedModel: "claude-sonnet-5",
        totals: { billableTokens: 4 + 12371 + 13087 + 671 + 907 + 12 },
      });
      expect(call.headers["idempotency-key"]).toBe(call.body.eventId);
      const report = harness.db
        .select()
        .from(claudeCodeUsageReports)
        .where(eq(claudeCodeUsageReports.messageId, assistant.id))
        .get()!;
      expect(report.status).toBe("reported");
      expect(report.chargedUsd).toBe("0.0159");

      // The CLI was launched restricted, in the app directory, with the app's rules.
      const invocation = readInvocations().at(-1)!;
      expect(invocation.cwd).toBe(fs.realpathSync(harness.appDir));
      expect(invocation.argv).toContain("--restricted");
      expect(
        (invocation.argv as string[])[
          (invocation.argv as string[]).indexOf("--tools") + 1
        ],
      ).toBe("Read,Glob,Grep,Edit,Write");
      expect(invocation.hasAnthropicApiKey).toBe(false);
      expect(String(invocation.systemPromptAppendix)).toContain(
        "Dyad workspace",
      );
    }, 30_000);

    it("resumes the chat's own session on the next turn and never another chat's", async () => {
      const chatId = await newChat();
      await harness.streamChat("[scenario:write-file] first", { chatId });
      const chat = await harness.db.query.chats.findFirst({
        where: eq(chats.id, chatId),
      });
      const sessionId = chat!.claudeCodeSessionId!;

      await harness.streamChat("[scenario:resume-check] again", { chatId });
      const assistant = (await loadRows(chatId))
        .filter((m) => m.role === "assistant")
        .at(-1)!;
      expect(assistant.content).toContain(`resumed:${sessionId}`);

      const otherChatId = await newChat();
      await harness.streamChat("[scenario:resume-check] other", {
        chatId: otherChatId,
      });
      const otherAssistant = (await loadRows(otherChatId))
        .filter((m) => m.role === "assistant")
        .at(-1)!;
      expect(otherAssistant.content).toContain("resumed:none");
      const otherChat = await harness.db.query.chats.findFirst({
        where: eq(chats.id, otherChatId),
      });
      expect(otherChat!.claudeCodeSessionId).not.toBe(sessionId);
    }, 30_000);

    it("denies Bash and surfaces the block in the transcript", async () => {
      const chatId = await newChat();
      const { eventsFor } = await harness.streamChat(
        "[scenario:bash] list files",
        {
          chatId,
        },
      );
      const rows = await loadRows(chatId);
      expect(eventsFor("chat:response:error")).toHaveLength(0);
      const assistant = rows.find((m) => m.role === "assistant")!;
      expect(assistant.content).toContain("Dyad blocked Bash");
      expect(assistant.content).toContain("Bash deny");
    }, 30_000);

    it("rejects edits in Ask mode through the tool permission channel", async () => {
      const chatId = await newChat();
      await harness.streamChat("[scenario:edit-attempt] edit", {
        chatId,
        requestedChatMode: "ask",
      });
      const rows = await loadRows(chatId);
      const assistant = rows.find((m) => m.role === "assistant")!;
      expect(assistant.content).toContain("Write deny");
      expect(assistant.content).toContain("read-only");
      expect(harness.appFileExists("src/ask-mode.txt")).toBe(false);
      // Ask mode never creates a checkpoint.
      expect(assistant.commitHash).toBeNull();
      const invocation = readInvocations().at(-1)!;
      expect(
        (invocation.argv as string[])[
          (invocation.argv as string[]).indexOf("--tools") + 1
        ],
      ).toBe("Read,Glob,Grep");
    }, 30_000);

    it("serves Dyad operations over the in-process MCP bridge", async () => {
      const chatId = await newChat();
      await harness.streamChat("[scenario:mcp-read-logs] logs", { chatId });
      const rows = await loadRows(chatId);
      const assistant = rows.find((m) => m.role === "assistant")!;
      expect(assistant.content).toContain("server:dyad");
      expect(assistant.content).toContain("<dyad-read-logs>");
      expect(assistant.content).toContain("No logs found");
    }, 30_000);

    it("asks for consent on add_dependency and records the refusal", async () => {
      const chatId = await newChat();
      const streaming = harness.streamChat(
        "[scenario:mcp-add-dependency] add",
        { chatId },
      );
      const { userInputRegistry } = await import("@/user_input/main");
      await vi.waitFor(
        () => {
          expect(
            userInputRegistry
              .getPending()
              .some(
                (p) =>
                  p.descriptor.kind === "agent-consent" &&
                  p.descriptor.chatId === chatId,
              ),
          ).toBe(true);
        },
        { timeout: 10_000 },
      );
      const pending = userInputRegistry
        .getPending()
        .find(
          (p) =>
            p.descriptor.kind === "agent-consent" &&
            p.descriptor.chatId === chatId,
        )!;
      expect(pending.descriptor).toMatchObject({
        kind: "agent-consent",
        toolName: "add_dependency",
        inputPreview: "Install or refresh left-pad",
      });
      await userInputRegistry.respond(pending.descriptor.requestId, {
        kind: "agent-consent",
        decision: "decline",
      });
      await streaming;
      const rows = await loadRows(chatId);
      const assistant = rows.find((m) => m.role === "assistant")!;
      expect(assistant.content).toContain("add_dependency deny");
    }, 30_000);

    it("cancels an active turn, terminates the CLI, and keeps the usage it reported", async () => {
      const chatId = await newChat();
      const before = readInvocations().length;
      const streaming = harness.streamChat("[scenario:slow] essay", { chatId });
      await vi.waitFor(
        () => expect(readInvocations().length).toBe(before + 1),
        {
          timeout: 10_000,
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const cancel = h.ipcHandlers.get("chat:cancel")!;
      await cancel(createFakeIpcEvent([]), chatId);
      const { eventsFor } = await streaming;
      const rows = await loadRows(chatId);
      const assistant = rows.find((m) => m.role === "assistant")!;
      expect(assistant.content).toContain("[Response cancelled by user]");
      const end = eventsFor("chat:response:end").at(-1)?.payload as {
        wasCancelled?: boolean;
      };
      expect(end?.wasCancelled).toBe(true);
      await vi.waitFor(() => {
        expect(
          readInvocations().some((line) => line.interrupted === true),
        ).toBe(true);
      });
      const report = harness.db
        .select()
        .from(claudeCodeUsageReports)
        .where(eq(claudeCodeUsageReports.messageId, assistant.id))
        .get()!;
      expect(JSON.parse(report.payloadJson).correlation.turnStatus).toBe(
        "cancelled",
      );
    }, 30_000);

    it("refuses to run a Claude Code turn on a chat bound to the Dyad backend", async () => {
      const chatId = await newChat();
      await harness.db
        .update(chats)
        .set({ executionBackend: "dyad" })
        .where(eq(chats.id, chatId));
      const { eventsFor } = await harness.streamChat(
        "[scenario:write-file] x",
        {
          chatId,
        },
      );
      expect(await loadRows(chatId)).toHaveLength(0);
      const error = eventsFor("chat:response:error")[0].payload as {
        error: string;
      };
      expect(error.error).toContain("Switching backends requires a new chat");
    }, 30_000);

    it("surfaces a missing CLI session without silently starting a new one", async () => {
      const chatId = await newChat();
      await harness.db
        .update(chats)
        .set({ claudeCodeSessionId: "00000000-0000-4000-8000-000000000000" })
        .where(eq(chats.id, chatId));
      const { eventsFor } = await harness.streamChat(
        "[scenario:session-missing] continue",
        { chatId },
      );
      const rows = await loadRows(chatId);
      const error = eventsFor("chat:response:error")[0].payload as {
        error: string;
      };
      expect(error.error).toContain("no longer exists");
      const assistant = rows.find((m) => m.role === "assistant")!;
      expect(assistant.content).toContain("Claude Code turn failed");
      expect(assistant.model).toBeNull();
      const report = harness.db
        .select()
        .from(claudeCodeUsageReports)
        .where(eq(claudeCodeUsageReports.messageId, assistant.id))
        .get()!;
      expect(report.status).toBe("rejected");
      expect(report.lastError).toContain("no usage");
    }, 30_000);

    it("keeps usage pending and retries when the engine is unavailable", async () => {
      engineStatus = 503;
      const chatId = await newChat();
      await harness.streamChat("[scenario:write-file] retry", { chatId });
      const rows = await loadRows(chatId);
      const assistant = rows.find((m) => m.role === "assistant")!;
      await vi.waitFor(() => expect(trackUsageCalls.length).toBeGreaterThan(0));
      await vi.waitFor(() => {
        const row = harness.db
          .select()
          .from(claudeCodeUsageReports)
          .where(eq(claudeCodeUsageReports.messageId, assistant.id))
          .get()!;
        expect(row.status).toBe("pending");
        expect(row.attempts).toBe(1);
      });
      engineStatus = 200;
      const flushed = await flushPendingClaudeCodeUsageReports({ force: true });
      expect(flushed.reported).toBeGreaterThanOrEqual(1);
      const row = harness.db
        .select()
        .from(claudeCodeUsageReports)
        .where(eq(claudeCodeUsageReports.messageId, assistant.id))
        .get()!;
      expect(row.status).toBe("reported");
      // Same event id on every attempt: the engine can dedupe safely.
      const ids = trackUsageCalls
        .map((call) => call.body.eventId)
        .filter((id) => id === row.id);
      expect(ids.length).toBeGreaterThanOrEqual(2);
    }, 30_000);
  },
);
