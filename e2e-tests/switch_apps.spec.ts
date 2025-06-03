import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("switch apps", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("hi");
  const firstAppName = await po.getCurrentAppName();

  await po.goToAppsTab();
  await po.sendPrompt("second-app");
  const secondAppName = await po.getCurrentAppName();
  expect(secondAppName).not.toBe(firstAppName);
});
