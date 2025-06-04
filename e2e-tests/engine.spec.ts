import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("send message to engine", async ({ po }) => {
  await po.setUpDyadPro();
  // By default, it's using auto which points to Flash 2.5 and doesn't
  // use engine.
  await po.selectModel({ provider: "Google", model: "Gemini 2.5 Pro" });
  await po.sendPrompt("[dump] tc=turbo-edits");

  await po.snapshotServerDump("request");
  await po.snapshotMessages({ replaceDumpPath: true });
});

testSkipIfWindows("send message to gateway", async ({ po }) => {
  await po.setUpDyadPro();
  await po.selectModel({ provider: "Google", model: "Gemini 2.5 Flash" });
  await po.sendPrompt("[dump] tc=gateway-simple");

  await po.snapshotServerDump("request");
  await po.snapshotMessages({ replaceDumpPath: true });
});

// auto (defaults to Gemini 2.5 Flash)
testSkipIfWindows("auto should send message to gateway", async ({ po }) => {
  await po.setUpDyadPro();
  await po.sendPrompt("[dump] tc=gateway-simple");

  await po.snapshotServerDump("request");
  await po.snapshotMessages({ replaceDumpPath: true });
});
