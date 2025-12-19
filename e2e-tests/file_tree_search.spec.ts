import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test("file tree search finds matches by name and content", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.goToChatTab();
  await po.selectPreviewMode("code");
  // Wait for the code view to finish loading files
  await expect(
    po.page.getByText("Loading files...", { exact: false }),
  ).toBeHidden({ timeout: Timeout.MEDIUM });

  const searchInput = po.page.getByTestId("file-tree-search");
  await expect(searchInput).toBeVisible({ timeout: Timeout.MEDIUM });

  // Name search should surface the file even without a content match
  await searchInput.fill("App");
  await expect(po.page.getByText("app.tsx")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Content search should find files whose contents match the query
  await searchInput.fill("imported app");
  await expect(po.page.getByText("App.tsx")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
});
