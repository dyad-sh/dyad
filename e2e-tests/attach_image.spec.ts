import path from "path";
import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import * as fs from "fs";

// It's hard to read the snapshots, but they should be identical across
// all test cases in this file, so we use the same snapshot name to ensure
// the outputs are identical.
const SNAPSHOT_NAME = "attach-image";

// attach image is implemented in two separate components
// - HomeChatInput
// - ChatInput
// so we need to test both
test("attach image - home chat", async ({ po }) => {
  await po.setUp();

  await po
    .getHomeChatInputContainer()
    .getByTestId("chat-context-file-input")
    .setInputFiles("e2e-tests/fixtures/images/logo.png");
  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("last-message", { name: SNAPSHOT_NAME });
  await po.snapshotMessages({ replaceDumpPath: true });
});

test("attach image - chat", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("basic");

  // attach via file input (click-to-upload)
  await po
    .getChatInputContainer()
    .getByTestId("chat-context-file-input")
    .setInputFiles("e2e-tests/fixtures/images/logo.png");
  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("last-message", { name: SNAPSHOT_NAME });
  await po.snapshotMessages({ replaceDumpPath: true });
});

test("attach image - chat - upload to codebase", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("basic");

  // attach via file input (click-to-upload)
  await po
    .getChatInputContainer()
    .getByTestId("upload-to-codebase-file-input")
    .setInputFiles("e2e-tests/fixtures/images/logo.png");
  await po.sendPrompt("[[UPLOAD_IMAGE_TO_CODEBASE]]");

  await po.snapshotServerDump("last-message", { name: "upload-to-codebase" });
  await po.snapshotMessages({ replaceDumpPath: true });

  // new/image/file.png
  const appPath = await po.getCurrentAppPath();
  const filePath = path.join(appPath, "new", "image", "file.png");
  expect(fs.existsSync(filePath)).toBe(true);
  // check contents of filePath is equal in value to e2e-tests/fixtures/images/logo.png
  const expectedContents = fs.readFileSync(
    "e2e-tests/fixtures/images/logo.png",
    "base64",
  );
  const actualContents = fs.readFileSync(filePath, "base64");
  expect(actualContents).toBe(expectedContents);
});

// attach image via drag-and-drop to chat input container
test("attach image via drag - chat", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("basic");
  // read fixture and convert to base64 for browser context
  const fileBase64 = fs.readFileSync(
    "e2e-tests/fixtures/images/logo.png",
    "base64",
  );
  // locate the inner drop target (first child div of the container)
  const dropTarget = po.getChatInputContainer().locator("div").first();
  // simulate dragenter, dragover, and drop with a File
  await dropTarget.evaluate((element, fileBase64) => {
    // convert base64 to Uint8Array
    const binary = atob(fileBase64);
    const len = binary.length;
    const array = new Uint8Array(len);
    for (let i = 0; i < len; i++) array[i] = binary.charCodeAt(i);
    // create file and dataTransfer
    const blob = new Blob([array], { type: "image/png" });
    const file = new File([blob], "logo.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    // dispatch drag events
    ["dragenter", "dragover", "drop"].forEach((eventType) => {
      element.dispatchEvent(
        new DragEvent(eventType, { dataTransfer: dt, bubbles: true }),
      );
    });
  }, fileBase64);

  // submit and verify
  await po.sendPrompt("[dump]");
  // Note: this should match EXACTLY the server dump from the previous test.
  await po.snapshotServerDump("last-message", { name: SNAPSHOT_NAME });
  await po.snapshotMessages({ replaceDumpPath: true });
});
