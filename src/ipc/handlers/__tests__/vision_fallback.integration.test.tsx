// Covers the vision fallback end to end: a model the catalog marks
// `supportsVision: false` must never receive raw image parts, and must instead
// receive a text description in its place.
//
// The catalog fixture in testing/fake-llm-server/index.ts supplies the flag
// here (the harness points the catalog fetch at the fake server), not
// MODEL_OPTIONS.
import { cleanup, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

// 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function pngBytes(): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(PNG_BASE64, "base64");
  // Copy into a plain ArrayBuffer: Buffer's backing store is typed as
  // ArrayBufferLike, which is not assignable to BlobPart.
  const bytes = new Uint8Array(new ArrayBuffer(decoded.byteLength));
  bytes.set(decoded);
  return bytes;
}

type DumpMessage = { content?: unknown };
type DumpBody = { input?: DumpMessage[]; messages?: DumpMessage[] };

/** Counts structured image parts across every message in the dumped request. */
function imagePartCount(parsedBody: DumpBody): number {
  const messages = parsedBody?.input ?? parsedBody?.messages ?? [];
  return messages
    .flatMap((message) =>
      Array.isArray(message?.content)
        ? (message.content as { type?: string }[])
        : [],
    )
    .filter((part) => part?.type === "image" || part?.type === "image_url")
    .length;
}

const PRO_SETTINGS = {
  isTestMode: true,
  enableDyadPro: true,
  providerSettings: { auto: { apiKey: { value: "testdyadkey" } } },
};

describe("vision fallback for a non-vision model (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      // Marked `supportsVision: false` in the fake catalog fixture.
      selectedModel: { provider: "openai", name: "gpt-5.2-no-vision" },
      settings: PRO_SETTINGS,
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("describes the image as text and sends no image part", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    harness.setChatAttachments([
      {
        name: "mockup.png",
        content: pngBytes(),
        mimeType: "image/png",
        type: "chat-context",
      },
    ]);
    await screen.findByText("mockup.png");

    const streamEnd = harness.waitForNextStreamEnd(chatId);
    const { send } = await harness.typeInChat("[dump]", { chatId });
    send();
    await streamEnd;

    // The turn must complete rather than surfacing a raw provider error.
    expect(
      harness.bridge.sentEvents.filter(
        (event) => event.channel === "chat:response:error",
      ),
    ).toHaveLength(0);

    const req = harness.getServerDump({ type: "request" });

    // No raw image part reached the non-vision model...
    expect(imagePartCount(req.parsed.body)).toBe(0);
    // ...and a description took its place.
    expect(req.text).toContain("dyad-image-description");
    // The "analyze the image" system block must not be emitted when no image
    // is actually sent.
    expect(req.text).not.toContain("# Image Analysis Instructions");
  }, 60_000);
});

describe("vision-capable model still receives images (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      engine: true,
      // Not marked in the fake catalog, so it is treated as vision-capable.
      selectedModel: { provider: "openai", name: "gpt-5.2" },
      settings: PRO_SETTINGS,
    });
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("sends the image part and injects no description", async () => {
    const chatId = await harness.createChat();
    harness.mount({ chatId });

    harness.setChatAttachments([
      {
        name: "mockup.png",
        content: pngBytes(),
        mimeType: "image/png",
        type: "chat-context",
      },
    ]);
    await screen.findByText("mockup.png");

    const streamEnd = harness.waitForNextStreamEnd(chatId);
    const { send } = await harness.typeInChat("[dump]", { chatId });
    send();
    await streamEnd;

    const req = harness.getServerDump({ type: "request" });

    expect(imagePartCount(req.parsed.body)).toBeGreaterThan(0);
    expect(req.text).not.toContain("dyad-image-description");
  }, 60_000);
});
