import fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("project-wide TypeScript setting (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        runTypeScriptForWholeProject: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("sends the project-wide description and omits paths from the tool schema", async () => {
    harness.mount();
    await waitFor(
      () => {
        expect(screen.getByTestId("messages-list")).toBeTruthy();
        expect(screen.getByTestId("chat-input-container")).toBeTruthy();
      },
      { timeout: 15_000 },
    );

    await harness.selectChatMode("local-agent");

    const streamEnd = harness.waitForNextStreamEnd(harness.chatId);
    const { send } = await harness.typeInChat("[dump]");
    send();

    await waitFor(
      () => expect(screen.getByText(/dyad-dump-path/)).toBeTruthy(),
      { timeout: 20_000 },
    );
    await streamEnd;

    const request = harness.getServerDump({ type: "request" });
    const raw = JSON.parse(fs.readFileSync(request.dumpPath, "utf-8"));
    const typeCheckTool = raw.body.tools.find(
      (tool: { function?: { name?: string } }) =>
        tool.function?.name === "run_type_checks",
    ).function;

    expect(typeCheckTool.description).toContain(
      "return diagnostics for all files",
    );
    expect(typeCheckTool.description).toContain(
      "normally act only on errors introduced by or related to your changes",
    );
    expect(typeCheckTool.description).not.toContain("paths");
    expect(typeCheckTool.parameters.properties).not.toHaveProperty("paths");
    expect([...harness.bridge.missingChannels]).toEqual([]);
  }, 60_000);
});
