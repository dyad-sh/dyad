import { test } from "./helpers/test_helper";

test("send message to engine", async ({ po }) => {
  await po.setUpDyadPro();
  // By default, it's using auto which points to Flash 2.5 and doesn't
  // use engine.
  await po.selectModel({ provider: "Google", model: "Gemini 2.5 Pro" });
  await po.sendPrompt("[dump] tc=turbo-edits");

  await po.snapshotServerDump("request");
  await po.snapshotMessages({ replaceDumpPath: true });
});
