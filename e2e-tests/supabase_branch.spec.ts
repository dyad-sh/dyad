import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("supabase branch selection works", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.sendPrompt("tc=add-supabase");

  // Connect to Supabase
  await po.page.getByText("Set up supabase").click();
  await po.clickConnectSupabaseButton();
  await po.clickBackButton();
  await po.page.getByTestId("token-bar-toggle").click();
  // The default branch has a small context.
  await expect(po.page.getByTestId("token-bar")).toContainText("6% of 128K");

  await po.getTitleBarAppNameButton().click();
  await po.page.getByTestId("supabase-branch-select").click();
  await po.page.getByRole("option", { name: "Test Branch" }).click();

  await po.clickBackButton();
  // The test branch has a large context (200k tokens) so it'll hit the 100% limit.
  // This is to make sure we're connecting to the right supabase project for the branch.
  await expect(po.page.getByTestId("token-bar")).toContainText("100% of 128K");
});
