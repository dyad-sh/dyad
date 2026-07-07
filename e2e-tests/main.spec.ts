import { test } from "./helpers/test_helper";

// The canonical packaged-app smoke for the whole chat stack: real preload
// IPC, real Lexical typing, real i18n strings, streamed render. Deeper
// per-flow coverage lives in the vitest hybrid suite
// (src/ipc/handlers/__tests__/*.integration.test.ts).
test("simple message to custom test model", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("hi");
  await po.snapshotMessages();
});
