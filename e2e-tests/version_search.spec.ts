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

  // Favorite a version and add a note without checking it out
  const favoriteButton = po.page.getByTestId("version-favorite-button-2");
  await favoriteButton.click();
  await expect(favoriteButton.locator("svg")).toHaveClass(
    /(?:^|\s)fill-\[#6c55dc\]/,
  );

  const versionNote = "Stable landing screen";
  const noteInput = po.page.getByLabel("Note for version 2");
  await noteInput.fill(versionNote);
  await searchInput.click();
  await po.page.waitForTimeout(800);
  await expect(po.page.getByRole("button", { name: "Version" })).toHaveText(
    "Version 2",
  );

  // Favorites-only filter should hide unfavorited versions
  await po.page
    .getByRole("button", { name: "Show favorite versions only" })
    .click();
  await expect(po.page.getByTestId("version-row-2")).toBeVisible();
  await expect(po.page.getByTestId("version-row-1")).toBeHidden();

  // Closing and reopening resets the filter to all versions while preserving metadata
  await po.page.getByLabel("Close version pane").click();
  await po.page.getByRole("button", { name: "Version" }).click();
  await expect(po.page.getByTestId("version-row-1")).toBeVisible();
  await expect(po.page.getByLabel("Note for version 2")).toHaveValue(
    versionNote,
  );
  await expect(
    po.page.getByTestId("version-favorite-button-2").locator("svg"),
  ).toHaveClass(/(?:^|\s)fill-\[#6c55dc\]/);

  // Notes are searchable
  await po.page.getByLabel("Search versions").fill("Stable landing");
  await expect(po.page.getByTestId("version-row-2")).toBeVisible();
  await expect(po.page.getByTestId("version-row-1")).toBeHidden();
  await po.page.getByLabel("Clear search").click();

  // Search by message text
  await searchInput.fill("Init Dyad");
  await expect(po.page.getByText("Init Dyad app")).toBeVisible();
});
