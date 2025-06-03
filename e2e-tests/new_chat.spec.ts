import { test } from "./helpers/test_helper";

const newChatTestCases = [
  { name: "first button", clickOptions: undefined },
  { name: "second button", clickOptions: { index: 1 } },
];

newChatTestCases.forEach(({ name, clickOptions }) => {
  test(`new chat (${name})`, async ({ po }) => {
    await po.setUp();
    await po.sendPrompt("tc=chat1");
    await po.snapshotMessages();
    await po.clickNewChat(clickOptions);

    // Make sure it's empty
    await po.snapshotMessages();

    await po.sendPrompt("tc=chat2");
    await po.snapshotMessages();
  });
});
