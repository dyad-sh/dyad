import { expect } from "@playwright/test";
import fs from "fs";
import { test } from "./helpers/test_helper";

test("caveman mode - ultra injects system prompt", async ({ po }) => {
  await po.setUpDyadPro();

  await po.navigation.goToSettingsTab();
  await po.page.getByRole("combobox", { name: /Caveman Mode/i }).click();

  const ultraOption = po.page.getByRole("option", { name: /Ultra/i });
  await ultraOption.waitFor({ state: "visible" });
  await ultraOption.click();

  await expect(
    po.page.getByRole("combobox", { name: /Caveman Mode/i }),
  ).toHaveText(/Ultra/i);

  await po.page.getByText("Go Back").click();
  await po.sendPrompt("[dump] caveman mode request");

  await expect(po.page.getByTestId("messages-list")).toContainText(
    "[[dyad-dump-path=",
  );

  const messagesListText = await po.page
    .getByTestId("messages-list")
    .textContent();
  const dumpMatches = [
    ...(messagesListText?.matchAll(/\[\[dyad-dump-path=([^\]]+)\]\]/g) ?? []),
  ];
  expect(dumpMatches.length).toBeGreaterThan(0);

  const rawDump = fs.readFileSync(dumpMatches.at(-1)![1], "utf-8");

  expect(rawDump).toMatch(/# CAVEMAN MODE: ULTRA/i);
});
