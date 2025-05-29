import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("renders the first page", async ({ electronApp }) => {
  const page = await electronApp.firstWindow();
  await page.waitForSelector("h1");
  const text = await page.$eval("h1", (el) => el.textContent);
  expect(text).toBe("Build your dream app");
});

test("simple message to custom test model", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("hi");
  await po.dumpMessages();
});

test("basic message to custom test model", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=basic");
  await po.dumpMessages();
});
