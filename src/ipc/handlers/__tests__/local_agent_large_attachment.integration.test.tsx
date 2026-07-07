import fs from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

function buildLargeLog(): string {
  const lines = Array.from(
    { length: 6_000 },
    (_, index) =>
      `line-${index.toString().padStart(4, "0")} DYAD_LARGE_ATTACHMENT_MARKER payload ${"x".repeat(80)}`,
  );
  lines.push("TAIL_SENTINEL_98765");
  return `${lines.join("\n")}\n`;
}

describe("local-agent large attachment (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      chatMode: "local-agent",
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
      },
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("reads a large chat-context attachment from MustardScript", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    harness.setChatAttachments([
      {
        name: "large-log.txt",
        content: buildLargeLog(),
        mimeType: "text/plain",
      },
    ]);
    await screen.findByText("large-log.txt");

    const { send } = await harness.typeInChat(
      "tc=local-agent/large-attachment-sandbox",
      { chatId },
    );
    send();

    const scriptCard = await screen.findByTestId(
      "dyad-script-card",
      undefined,
      { timeout: 20_000 },
    );
    expect(scriptCard.textContent).toContain("Summarize large-log.txt");
    fireEvent.click(scriptCard);
    fireEvent.click(await screen.findByText("Output"));

    await waitFor(
      () => {
        expect(scriptCard.textContent).toContain('"markerCount": 6000');
        expect(scriptCard.textContent).toContain('"hasTail": true');
      },
      { timeout: 20_000 },
    );
    expect(
      screen.queryByText("Your model did not reference the attached file"),
    ).toBeNull();
    await harness.waitForStreamEnd(chatId);

    const manifestPath = path.join(
      harness.appDir,
      ".dyad",
      "media",
      "attachments-manifest.json",
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalName: "large-log.txt",
          originalName: "large-log.txt",
          mimeType: "text/plain",
        }),
      ]),
    );
  }, 60_000);
});
