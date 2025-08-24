import { test } from "./helpers/test_helper";
import type { PageObject } from "./helpers/test_helper";

test(
  "qwen code integration - basic code write flow",
  async ({ po }: { po: PageObject }) => {

  await po.setUp();
  await po.selectModel({ provider: "test-provider", model: "test-model" });

  await po.sendPrompt("[[QWEN_CODE_TEST]]");

  await po.snapshotServerDump("request");

  await po.snapshotMessages({ replaceDumpPath: true });
});


