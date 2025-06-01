import { test } from "./helpers/test_helper";

// attach image is implemented in two separate components
// - HomeChatInput
// - ChatInput
// so we need to test both
test("attach image - home chat", async ({ po }) => {
  await po.setUp();

  await po
    .getHomeChatInputContainer()
    .locator("input[type='file']")
    .setInputFiles("e2e-tests/fixtures/images/logo.png");
  await po.sendPrompt("[dump]");
  await po.snapshotServerDump({ onlyLastMessage: true });
  await po.snapshotMessages({ replaceDumpPath: true });
});

test("attach image - chat", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("basic");

  await po
    .getChatInputContainer()
    .locator("input[type='file']")
    .setInputFiles("e2e-tests/fixtures/images/logo.png");
  await po.sendPrompt("[dump]");
  await po.snapshotServerDump({ onlyLastMessage: true });
  await po.snapshotMessages({ replaceDumpPath: true });
});
