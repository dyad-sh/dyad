// @vitest-environment node
//
// Migrated from e2e-tests/local_agent_file_upload.spec.ts.
//
// When a file is attached with "upload to codebase" mode in local-agent
// (Agent v2) mode, the agent's copy_file tool copies the stored attachment
// (referenced as `attachments:<name>`) into the codebase at the destination
// path. Driven by the fake LLM server's `tc=local-agent/upload-to-codebase`
// fixture (copy_file from attachments:logo.png to assets/uploaded-file.png).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
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

const LOGO_PATH = path.resolve(
  __dirname,
  "../../../../e2e-tests/fixtures/images/logo.png",
);

describe("local agent file upload to codebase (integration)", () => {
  let harness: ChatFlowHarness;

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
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("copies an uploaded attachment into the codebase via copy_file", async () => {
    const logoBase64 = fs.readFileSync(LOGO_PATH, "base64");
    const { messages, events, eventsFor } = await harness.streamChat(
      "tc=local-agent/upload-to-codebase",
      {
        attachments: [
          {
            name: "logo.png",
            type: "image/png",
            data: `data:image/png;base64,${logoBase64}`,
            attachmentType: "upload-to-codebase",
          },
        ],
      },
    );
    // The local-agent branch of chat:stream returns void; success is signaled
    // by the stream-end event and the absence of error events.
    expect(eventsFor("chat:response:error")).toHaveLength(0);
    expect(events.map((e) => e.channel)).toContain("chat:stream:end");

    // The file was copied into the codebase with the original bytes.
    const uploadedPath = path.join(
      harness.appDir,
      "assets",
      "uploaded-file.png",
    );
    expect(fs.existsSync(uploadedPath)).toBe(true);
    expect(fs.readFileSync(uploadedPath, "base64")).toBe(logoBase64);

    // The assistant transcript records the copy_file tool card and the
    // final confirmation text.
    const assistant = messages.find((m) => m.role === "assistant")!;
    expect(assistant.content).toContain(
      "I'll upload your file to the codebase.",
    );
    expect(assistant.content).toContain(
      '<dyad-copy from="attachments:logo.png" to="assets/uploaded-file.png"',
    );
    expect(assistant.content).toContain(
      "I've successfully copied your file to assets/uploaded-file.png in the codebase.",
    );
  }, 30_000);
});
