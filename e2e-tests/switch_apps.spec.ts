import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("switch apps", async ({ po }) => {
  await po.setUp();
  await po.chatActions.sendPrompt("hi");
  const firstAppName = await po.appManagement.getCurrentAppName();

  await po.navigation.goToAppsTab();
  await po.chatActions.sendPrompt("second-app");
  const secondAppName = await po.appManagement.getCurrentAppName();
  expect(secondAppName).not.toBe(firstAppName);
});
