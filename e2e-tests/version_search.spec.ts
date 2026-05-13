import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("version search", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=write-index");

  // Wait for version 2 to appear
  await expect(po.page.getByRole("button", { name: "Version" })).toHaveText(
    "Version 2",
    { timeout: Timeout.MEDIUM },
  );

  // Open version pane
  await po.page.getByRole("button", { name: "Version" }).click();

  // Both versions should be visible
  await expect(po.page.getByText("Init Dyad app")).toBeVisible();
  await expect(po.page.getByText(/Version 2 \(/)).toBeVisible();

  const searchInput = po.page.getByLabel("Search versions");
  await expect(searchInput).toBeVisible();

  // Search by version number (the new feature)
  await searchInput.fill("1");
  await expect(po.page.getByText("Init Dyad app")).toBeVisible();

  // Search for something with no results
  await searchInput.fill("nonexistent-query-xyz");
  await expect(po.page.getByText("No matching versions")).toBeVisible();

  // Clear search and verify all versions reappear
  await po.page.getByLabel("Clear search").click();
  await expect(po.page.getByText("Init Dyad app")).toBeVisible();
  await expect(po.page.getByText(/Version 2 \(/)).toBeVisible();

  // Search by message text
  await searchInput.fill("Init Dyad");
  await expect(po.page.getByText("Init Dyad app")).toBeVisible();
});
