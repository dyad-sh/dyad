// Migrated from e2e-tests/mcp.spec.ts, mcp_out_of_order.spec.ts,
// mcp_auto_consent.spec.ts, and the MCP cases in local_agent_advanced.spec.ts.
//
// These tests seed MCP servers through the real mcp:* IPC handlers, then drive
// the real ChatPanel consent/tool-card UI over the real chat/local-agent stack.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { asc, eq } from "drizzle-orm";

import { messages as messagesTable } from "@/db/schema";
import { ipc } from "@/ipc/types";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("MCP chat flows (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
        enableMcpServersForBuildMode: true,
        enableSandboxScriptExecution: true,
        enableMcpToolSearch: true,
        enableCodeExplorer: false,
      },
    });
  }, 60_000);

  beforeEach(async () => {
    await harness.mcp.resetServers();
    await ipc.settings.setUserSettings({
      autoApproveSafeMcpTools: false,
      enableMcpServersForBuildMode: true,
      enableSandboxScriptExecution: true,
      enableMcpToolSearch: true,
      enableCodeExplorer: false,
    });
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  async function mountChat(mode: "build" | "local-agent"): Promise<number> {
    const chatId = await harness.createChat();
    harness.mount({ chatId });
    await waitFor(() => {
      expect(screen.getByTestId("messages-list")).toBeTruthy();
      expect(screen.getByTestId("chat-input-container")).toBeTruthy();
    });
    await harness.selectChatMode(mode);
    return chatId;
  }

  async function assistantContents(chatId: number): Promise<string[]> {
    const rows = await harness.db.query.messages.findMany({
      where: eq(messagesTable.chatId, chatId),
      orderBy: [asc(messagesTable.id)],
    });
    return rows
      .filter((row) => row.role === "assistant")
      .map((row) => row.content);
  }

  async function clickAllowOnce(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: "Allow once" }));
  }

  async function clickAlwaysAllow(): Promise<void> {
    fireEvent.click(
      await screen.findByRole("button", { name: "Always allow" }),
    );
  }

  it("calls a stdio MCP tool from build mode after consent", async () => {
    await harness.mcp.addStdioServer({
      env: { testKey1: "testValue1" },
    });
    const chatId = await mountChat("build");

    const streamEnd = harness.waitForNextStreamEnd(chatId, 30_000);
    const { send } = await harness.typeInChat("[call_tool=calculator_add]", {
      chatId,
    });
    send();

    await screen.findByRole("button", {
      name: /Always allow/,
    });
    expect(
      screen.getByRole("button", {
        name: /Tool testing-mcp-server calculator_add/,
      }),
    ).toBeTruthy();

    await clickAlwaysAllow();
    await streamEnd;

    const contents = await assistantContents(chatId);
    expect(contents.join("\n")).toContain(
      '<dyad-mcp-tool-call server="testing-mcp-server" tool="calculator_add"',
    );
    expect(contents.join("\n")).toContain(
      '<dyad-mcp-tool-result server="testing-mcp-server" tool="calculator_add"',
    );
    expect(
      harness.bridge.sentEvents.filter(
        (event) => event.channel === "chat:response:error",
      ),
    ).toHaveLength(0);
  }, 60_000);

  it("calls an HTTP MCP tool from build mode", async () => {
    const http = await harness.mcp.addHttpServer({
      headers: { Authorization: "testValue1" },
    });
    try {
      const chatId = await mountChat("build");

      const streamEnd = harness.waitForNextStreamEnd(chatId, 30_000);
      const { send } = await harness.typeInChat("[call_tool=calculator_add]", {
        chatId,
      });
      send();

      await clickAllowOnce();
      await streamEnd;

      expect(
        screen.getByRole("button", {
          name: /Tool testing-mcp-server calculator_add/,
        }),
      ).toBeTruthy();
      const contents = await assistantContents(chatId);
      expect(contents.join("\n")).toContain(
        '<dyad-mcp-tool-result server="testing-mcp-server" tool="calculator_add"',
      );
    } finally {
      await http.stop();
    }
  }, 60_000);

  it("keeps parallel MCP tool results merged while slow results are pending", async () => {
    await harness.mcp.addStdioServer({
      env: { SLOW_ADD_DELAY_MS: "4000" },
    });
    const chatId = await mountChat("build");

    const streamEnd = harness.waitForNextStreamEnd(chatId, 30_000);
    const { send } = await harness.typeInChat("[call_tools_out_of_order]", {
      chatId,
    });
    send();

    for (let i = 0; i < 2; i += 1) {
      await clickAlwaysAllow();
    }

    const fastCard = await screen.findByRole("button", {
      name: /Tool testing-mcp-server calculator_add/,
    });
    const slowCard = await screen.findByRole("button", {
      name: /Tool testing-mcp-server slow_add Running/,
    });

    expect(fastCard).toBeTruthy();
    expect(slowCard).toBeTruthy();
    expect(
      screen.getAllByRole("button", {
        name: /Tool testing-mcp-server (calculator_add|slow_add)/,
      }),
    ).toHaveLength(2);

    await waitFor(
      () =>
        expect(
          screen.queryByRole("button", {
            name: /Tool testing-mcp-server slow_add Running/,
          }),
        ).toBeNull(),
      { timeout: 10_000 },
    );
    await streamEnd;
  }, 60_000);

  it("auto-approves safe MCP host-function calls in local-agent mode", async () => {
    await ipc.settings.setUserSettings({ autoApproveSafeMcpTools: true });
    await harness.mcp.addStdioServer();
    const chatId = await mountChat("local-agent");

    const streamEnd = harness.waitForNextStreamEnd(chatId, 30_000);
    const { send } = await harness.typeInChat("tc=local-agent/mcp-calculator", {
      chatId,
    });
    send();

    await streamEnd;
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    expect(screen.getByText("Auto-approved")).toBeTruthy();
    expect(screen.getByText("safe tool")).toBeTruthy();
    expect(screen.getByText(/The sum of 5 and 3 is 8/)).toBeTruthy();
  }, 60_000);

  it("asks for destructive MCP host-function calls after classifier review", async () => {
    await ipc.settings.setUserSettings({ autoApproveSafeMcpTools: true });
    await harness.mcp.addStdioServer();
    const chatId = await mountChat("local-agent");

    const streamEnd = harness.waitForNextStreamEnd(chatId, 30_000);
    const { send } = await harness.typeInChat("tc=local-agent/mcp-delete", {
      chatId,
    });
    send();

    await screen.findByRole("button", { name: "Always allow" });
    expect(await screen.findByText(/Flagged for review/)).toBeTruthy();
    expect(await screen.findByText("destructive tool")).toBeTruthy();

    await clickAllowOnce();
    await streamEnd;
  }, 60_000);

  it("asks for safe MCP calls when auto-approval is disabled", async () => {
    await harness.mcp.addStdioServer();
    const chatId = await mountChat("local-agent");

    const streamEnd = harness.waitForNextStreamEnd(chatId, 30_000);
    const { send } = await harness.typeInChat("tc=local-agent/mcp-calculator", {
      chatId,
    });
    send();

    await screen.findByRole("button", { name: "Always allow" });
    await clickAllowOnce();
    await streamEnd;
    expect(screen.getByText(/The sum of 5 and 3 is 8/)).toBeTruthy();
  }, 60_000);

  it("auto-approves safe direct MCP tool calls when sandbox scripts are off", async () => {
    await ipc.settings.setUserSettings({
      autoApproveSafeMcpTools: true,
      enableSandboxScriptExecution: false,
    });
    await harness.mcp.addStdioServer();
    const chatId = await mountChat("local-agent");

    const streamEnd = harness.waitForNextStreamEnd(chatId, 30_000);
    const { send } = await harness.typeInChat(
      "tc=local-agent/mcp-calculator-direct",
      { chatId },
    );
    send();

    await streamEnd;
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    expect(screen.getByText(/The sum of 5 and 3 is 8/)).toBeTruthy();
  }, 60_000);

  it("lets the user approve while MCP auto-consent classification is pending", async () => {
    await ipc.settings.setUserSettings({ autoApproveSafeMcpTools: true });
    await harness.mcp.addStdioServer();
    const chatId = await mountChat("local-agent");

    const streamEnd = harness.waitForNextStreamEnd(chatId, 30_000);
    const { send } = await harness.typeInChat("tc=local-agent/mcp-print-envs", {
      chatId,
    });
    send();

    await screen.findByText(/reviewing this request/i);
    await clickAllowOnce();
    await streamEnd;
    await waitFor(() =>
      expect(screen.queryByText(/reviewing this request/i)).toBeNull(),
    );
  }, 60_000);

  it("renders MCP tool search cards in local-agent search mode", async () => {
    const previousThreshold = process.env.DYAD_MCP_INLINE_TOKEN_THRESHOLD;
    process.env.DYAD_MCP_INLINE_TOKEN_THRESHOLD = "0";
    try {
      await harness.mcp.addStdioServer();

      const chatId = await mountChat("local-agent");
      const streamEnd = harness.waitForNextStreamEnd(chatId, 30_000);
      const { send } = await harness.typeInChat(
        "tc=local-agent/mcp-tool-search",
        { chatId },
      );
      send();
      await streamEnd;
      expect(screen.getByText("MCP Tools")).toBeTruthy();
      expect(screen.getByText("add numbers")).toBeTruthy();
    } finally {
      if (previousThreshold === undefined) {
        delete process.env.DYAD_MCP_INLINE_TOKEN_THRESHOLD;
      } else {
        process.env.DYAD_MCP_INLINE_TOKEN_THRESHOLD = previousThreshold;
      }
    }
  }, 60_000);

  it("renders MCP tool schema cards in local-agent search mode", async () => {
    const previousThreshold = process.env.DYAD_MCP_INLINE_TOKEN_THRESHOLD;
    process.env.DYAD_MCP_INLINE_TOKEN_THRESHOLD = "0";
    try {
      await harness.mcp.addStdioServer();

      const chatId = await mountChat("local-agent");
      const streamEnd = harness.waitForNextStreamEnd(chatId, 30_000);
      const { send } = await harness.typeInChat(
        "tc=local-agent/get-mcp-tool-schema",
        { chatId },
      );
      send();
      await streamEnd;
      expect(screen.getByText("MCP Tool Schema")).toBeTruthy();
      expect(screen.getByText("calculator_add")).toBeTruthy();
    } finally {
      if (previousThreshold === undefined) {
        delete process.env.DYAD_MCP_INLINE_TOKEN_THRESHOLD;
      } else {
        process.env.DYAD_MCP_INLINE_TOKEN_THRESHOLD = previousThreshold;
      }
    }
  }, 60_000);
});
