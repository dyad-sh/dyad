// @vitest-environment node
//
// Migrated from e2e-tests/attach_image.spec.ts.
//
// The e2e exercised three UI entry points (home chat menu, chat menu, and
// drag-and-drop) that all funnel into the same backend behavior: the renderer
// base64-encodes the file and passes it as a `chat-context` attachment on
// `chat:stream`. The e2e asserted the three produced IDENTICAL server dumps,
// so a single integration test of the backend path covers them; the menu /
// drag interactions themselves are UI-only and are dropped.
//
// Covered behaviors:
//  - chat-context image attachment is stored in .dyad/media, rendered into the
//    user message as a <dyad-attachment> display tag, and sent to the LLM as
//    an image_url part alongside the "Attachments:" text.
//  - upload-to-codebase attachment: the LLM is told the stored path, replies
//    with a <dyad-copy> (fake server's [[UPLOAD_IMAGE_TO_CODEBASE]] behavior),
//    and the file is copied byte-for-byte into the codebase.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
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

const LOGO_PATH = path.join(
  process.cwd(),
  "e2e-tests",
  "fixtures",
  "images",
  "logo.png",
);

function logoAttachment(attachmentType: "chat-context" | "upload-to-codebase") {
  const base64 = fs.readFileSync(LOGO_PATH, "base64");
  return {
    name: "logo.png",
    type: "image/png",
    data: `data:image/png;base64,${base64}`,
    attachmentType,
  };
}

describe("attach image (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("sends a chat-context image attachment to the LLM", async () => {
    // Mirror the e2e: a plain turn first, then the [dump] turn with the image.
    await harness.streamChat("basic");
    const { result, messages } = await harness.streamChat("[dump]", {
      attachments: [logoAttachment("chat-context")],
    });
    expect(result).toBe(harness.chatId);

    // The attachment file is persisted under .dyad/media (hash-named .png).
    const mediaDir = path.join(harness.appDir, ".dyad", "media");
    const stored = fs.readdirSync(mediaDir).filter((f) => f.endsWith(".png"));
    expect(stored).toHaveLength(1);
    expect(fs.readFileSync(path.join(mediaDir, stored[0]), "base64")).toBe(
      fs.readFileSync(LOGO_PATH, "base64"),
    );

    // The db user message carries the <dyad-attachment> display tag.
    const userMessages = messages.filter((m) => m.role === "user");
    const lastUser = userMessages[userMessages.length - 1];
    expect(lastUser.content).toContain("<dyad-attachment");
    expect(lastUser.content).toContain('name="logo.png"');
    expect(lastUser.content).toContain('attachment-type="chat-context"');

    // The LLM request's last message is multi-part: attachment info text +
    // the image itself as a data URL.
    const dump = harness.getServerDump({ type: "last-message" });
    expect(dump.text).toContain('"type":"text"');
    expect(dump.text).toContain(
      "[dump]\\n\\nAttachments:\\n- logo.png (image/png)",
    );
    expect(dump.text).toContain('"type":"image_url"');
    expect(dump.text).toContain(
      `data:image/png;base64,${fs.readFileSync(LOGO_PATH, "base64")}`,
    );

    expect(dump.text).toMatchSnapshot("attach-image-last-message");
  }, 30_000);

  it("uploads an image attachment to the codebase via dyad-copy", async () => {
    const { result, messages } = await harness.streamChat(
      "[[UPLOAD_IMAGE_TO_CODEBASE]]",
      { attachments: [logoAttachment("upload-to-codebase")] },
    );
    expect(result).toBe(harness.chatId);

    // The fake server replies with a <dyad-copy from="<.dyad/media path>"
    // to="new/image/file.png"> which the response processor executes.
    const assistant = messages[messages.length - 1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toContain("<dyad-copy");
    expect(assistant.content).toContain('to="new/image/file.png"');
    expect(assistant.approvalState).toBe("approved");

    // The file was copied byte-for-byte into the codebase and committed.
    expect(harness.appFileExists("new/image/file.png")).toBe(true);
    expect(
      fs.readFileSync(
        path.join(harness.appDir, "new", "image", "file.png"),
        "base64",
      ),
    ).toBe(fs.readFileSync(LOGO_PATH, "base64"));

    // The LLM request told the model where the stored file lives (path is
    // masked by the shared normalization, as in the e2e snapshot).
    const dump = harness.getServerDump({ type: "last-message" });
    expect(dump.text).toContain("File to upload to codebase:");
    expect(dump.text).toContain("[[ATTACHMENT_PATH]]");
    expect(dump.text).toMatchSnapshot("upload-to-codebase-last-message");
  }, 30_000);
});
