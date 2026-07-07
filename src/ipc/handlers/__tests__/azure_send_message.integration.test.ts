// @vitest-environment node
//
// Migrated from e2e-tests/azure_send_message.spec.ts.
//
// The e2e set TEST_AZURE_BASE_URL / AZURE_API_KEY / AZURE_RESOURCE_NAME before
// launching Electron, selected the built-in Azure OpenAI provider's GPT-5
// model, sent "tc=basic" and snapshotted the rendered messages (aria-only).
// Here we run the same flow through the real chat:stream handler: the Azure
// branch of getModelClient sees TEST_AZURE_BASE_URL and routes to the fake
// server's /azure endpoints, and the assistant reply is the basic.md fixture.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  // Mirror the e2e preLaunchHook (values are read at request time via
  // getEnvVar, which snapshots the shell env on first use — so they must be
  // in process.env before anything calls getEnvVar).
  process.env.AZURE_API_KEY = "fake-azure-key-for-testing";
  process.env.AZURE_RESOURCE_NAME = "fake-resource-for-testing";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

describe("azure send message (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      // Built-in Azure OpenAI provider with the GPT-5 model, like
      // po.modelPicker.selectTestAzureModel() did.
      selectedModel: { provider: "azure", name: "gpt-5" },
      // With AZURE_* env vars present a free user would otherwise default to
      // Basic Agent mode; the e2e ran this chat in build mode.
      settings: { defaultChatMode: "build" },
    });
    process.env.TEST_AZURE_BASE_URL = `${harness.fakeLlmUrl}/azure`;
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
    delete process.env.TEST_AZURE_BASE_URL;
  });

  it("sends a message through Azure OpenAI and gets a response", async () => {
    const { result, messages, eventsFor } =
      await harness.streamChat("tc=basic");

    expect(result).toBe(harness.chatId);
    expect(eventsFor("chat:response:error")).toHaveLength(0);

    expect(messages).toHaveLength(2);
    const userMessage = messages.find((m) => m.role === "user")!;
    const assistantMessage = messages.find((m) => m.role === "assistant")!;
    expect(userMessage.content).toBe("tc=basic");
    // The /azure route streams back the basic.md fixture.
    expect(assistantMessage.content).toContain(
      "This is a simple basic response",
    );
  }, 30_000);

  it("routes the request to the Azure test endpoint with the Azure test key", async () => {
    await harness.streamChat("[dump]");

    // The fake server records the authorization header alongside the request
    // body. The Azure test branch of getModelClient hardcodes this key, so
    // seeing it proves the request went through the Azure provider path.
    const requestDump = harness.getServerDump({ type: "request" });
    const parsed = requestDump.parsed as {
      headers: { authorization: string };
      body: { model: string };
    };
    expect(parsed.headers.authorization).toBe(
      "Bearer fake-api-key-for-testing",
    );
    expect(parsed.body.model).toBe("[[MODEL]]");

    const unmasked = harness.getServerDump({
      type: "request",
      maskModel: false,
    });
    expect((unmasked.parsed as { body: { model: string } }).body.model).toBe(
      "gpt-5",
    );
  }, 30_000);
});
