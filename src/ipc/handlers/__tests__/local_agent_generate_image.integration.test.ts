// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_generate_image.spec.ts.
//
// Runs the local agent (Agent v2) loop against the fake LLM server's
// `tc=local-agent/generate-image` fixture: the model calls the generate_image
// tool (which hits the Dyad engine's /images/generations endpoint — the fake
// server returns a tiny 1x1 PNG as b64_json), the image is saved under the
// app's .dyad/media directory, and the model replies with a confirmation.
//
// generate_image requires Dyad Pro (isEnabled: ctx.isDyadPro) and calls the
// engine via DYAD_ENGINE_URL, which engine_fetch captures at module import.
// So we reserve an ephemeral port inside the hoisted block (before app
// modules load) and start a second fake-LLM server on it in beforeAll.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () => {
  process.env.NODE_ENV = "development";
  const net = await import("node:net");
  const enginePort: number = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
  process.env.DYAD_ENGINE_URL = `http://127.0.0.1:${enginePort}/engine/v1`;
  return { ipcHandlers: new Map(), enginePort };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import fs from "node:fs";
import path from "node:path";

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import {
  startFakeLlmServer,
  type FakeLlmServerHandle,
} from "../../../../testing/fake-llm-server/index";

// The fake engine's /images/generations returns this 1x1 white PNG.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

describe("local agent generate_image (integration)", () => {
  let harness: ChatFlowHarness;
  let engineServer: FakeLlmServerHandle;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      chatMode: "local-agent",
      settings: {
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "testdyadkey" } },
        },
      },
    });
    engineServer = await startFakeLlmServer({ port: h.enginePort });
  }, 30_000);

  afterAll(async () => {
    await engineServer?.close();
    await harness?.dispose();
  });

  it("generates an image and saves it to .dyad/media", async () => {
    const { messages, events, eventsFor } = await harness.streamChat(
      "tc=local-agent/generate-image",
    );
    // The local-agent branch of chat:stream returns void; success is signaled
    // by the stream-end event and the absence of error events.
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    expect(events.map((e) => e.channel)).toContain("chat:stream:end");

    const assistant = messages.find((m) => m.role === "assistant")!;
    // Turn 0 intro text.
    expect(assistant.content).toContain(
      "I'll generate a hero image for your landing page.",
    );
    // The completed image-generation tool card carries the saved media path.
    const match = assistant.content.match(
      /<dyad-image-generation prompt="[^"]+" path="([^"]+)">/,
    );
    expect(match).toBeTruthy();
    const relativePath = match![1];
    expect(relativePath).toMatch(
      /^\.dyad\/media\/generated-\d+-[0-9a-f]+\.png$/,
    );
    // Final confirmation text after the tool result was fed back to the model.
    expect(assistant.content).toContain(
      "I've generated the hero image and saved it to your project. You can find it in the .dyad/media directory.",
    );

    // The generated PNG was written to the app's .dyad/media directory with
    // the exact bytes the fake engine returned.
    const imagePath = path.join(harness.appDir, relativePath);
    expect(fs.existsSync(imagePath)).toBe(true);
    expect(fs.readFileSync(imagePath, "base64")).toBe(TINY_PNG_B64);
  }, 30_000);
});
