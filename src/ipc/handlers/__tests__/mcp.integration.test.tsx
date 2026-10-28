// Migrated from e2e-tests/mcp.spec.ts, mcp_out_of_order.spec.ts,
// mcp_auto_consent.spec.ts, and the MCP cases in local_agent_advanced.spec.ts.
//
// These tests seed MCP servers through the real mcp:* IPC handlers, then drive
// the real ChatPanel consent/tool-card UI over the real chat/local-agent stack.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fireEvent, screen, waitFor } from "@testing-library/react";
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
      enableSandboxScriptExecution: true,
      enableMcpToolSearch: true,
      enableCodeExplorer: false,
    });
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  async function mountChat(): Promise<number> {
    const chatId = await harness.createChat();
    harness.mount({ chatId });
    await waitFor(() => {
      expect(screen.getByTestId("messages-list")).toBeTruthy();
      expect(screen.getByTestId("chat-input-container")).toBeTruthy();
    });
    await harness.selectChatMode("local-agent");
    return chatId;
  }

  async function clickAllowOnce(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: "Allow once" }));
  }

  it("auto-approves safe MCP host-function calls in local-agent mode", async () => {
    await ipc.settings.setUserSettings({ autoApproveSafeMcpTools: true });
    await harness.mcp.addStdioServer();
    const chatId = await mountChat();

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
    const chatId = await mountChat();

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
    const chatId = await mountChat();

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
    const chatId = await mountChat();

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
    const chatId = await mountChat();

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

  it("bounds large MCP payloads in the transcript but passes them through whole", async () => {
    await ipc.settings.setUserSettings({ autoApproveSafeMcpTools: true });
    await harness.mcp.addStdioServer();
    const chatId = await mountChat();

    const streamEnd = harness.waitForNextStreamEnd(chatId, 60_000);
    const { send } = await harness.typeInChat(
      "tc=local-agent/mcp-large-payloads",
      { chatId },
    );
    send();
    await streamEnd;
    expect(await screen.findByText(/LARGE_PAYLOADS_DONE/)).toBeTruthy();

    // 30 calls send 3 MB of arguments. Each 200 KB result is cut to 128 KB
    // before the agent receives it, so 3.8 MB of results come back.
    const chat = await ipc.chat.getChat(chatId);
    const content = chat.messages[chat.messages.length - 1].content;
    expect(content.length).toBeLessThan(2_500_000);
    expect(content.match(/<dyad-mcp-tool-call /g)).toHaveLength(30);
    expect(content.match(/received 100000 chars/g)).toHaveLength(30);
    expect(content.match(/tool-truncated="true"/g)).toHaveLength(30);

    fireEvent.click(screen.getAllByText("ingest_payload")[0]);
    expect(
      await screen.findByText(/The input itself was not shortened/),
    ).toBeTruthy();
    expect(screen.getByText(/was cut before the agent got it/)).toBeTruthy();
  }, 90_000);

  it("renders MCP tool search cards in local-agent search mode", async () => {
    const previousThreshold = process.env.DYAD_MCP_INLINE_TOKEN_THRESHOLD;
    process.env.DYAD_MCP_INLINE_TOKEN_THRESHOLD = "0";
    try {
      await harness.mcp.addStdioServer();

      const chatId = await mountChat();
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

      const chatId = await mountChat();
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
