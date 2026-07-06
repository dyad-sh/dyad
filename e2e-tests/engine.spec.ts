import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("send message to engine", async ({ po }) => {
  await po.setUpDyadPro();
  await po.modelPicker.selectModel({
    provider: "Google",
    model: "Gemini 2.5 Pro",
  });
  await po.sendPrompt("[dump] tc=turbo-edits");

  await po.snapshotServerDump("request", { name: "engine-request-google" });
  await po.snapshotMessages({ replaceDumpPath: true });
});

testSkipIfWindows("send message to engine - openai gpt-5", async ({ po }) => {
  await po.setUpDyadPro();
  // By default, it's using auto which points to Flash 2.5 and doesn't
  // use engine.
  await po.modelPicker.selectModel({ provider: "OpenAI", model: "GPT 5" });
  await po.sendPrompt("[dump] tc=turbo-edits");

  await po.snapshotServerDump("request", { name: "engine-request-openai" });
});

testSkipIfWindows(
  "send message to engine - anthropic claude sonnet 4",
  async ({ po }) => {
    await po.setUpDyadPro();
    // By default, it's using auto which points to Flash 2.5 and doesn't
    // use engine.
    await po.modelPicker.selectModel({
      provider: "Anthropic",
      model: "Claude Sonnet 4",
    });
    await po.sendPrompt("[dump] tc=turbo-edits");

    await po.snapshotServerDump("request", {
      name: "engine-request-anthropic",
    });
  },
);

testSkipIfWindows(
  "smart auto should send message to engine",
  async ({ po }) => {
    await po.setUpDyadPro();
    await po.sendPrompt("[dump] tc=turbo-edits");

    await po.snapshotServerDump("request", {
      name: "engine-request-smart-auto",
    });
    await po.snapshotMessages({ replaceDumpPath: true });
  },
);

testSkipIfWindows(
  "regular auto should send message to engine",
  async ({ po }) => {
    await po.setUpDyadPro();
    const proModesDialog = await po.openProModesDialog({
      location: "home-chat-input-container",
    });
    await proModesDialog.setSmartContextMode("off");
    await proModesDialog.close();
    await po.sendPrompt("[dump] tc=turbo-edits");

    await po.snapshotServerDump("request", {
      name: "engine-request-regular-auto",
    });
    await po.snapshotMessages({ replaceDumpPath: true });
  },
);
