import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows("supabase client is generated", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.sendPrompt("tc=add-supabase");

  // Connect to Supabase
  await po.appManagement.startDatabaseIntegrationSetup("supabase");
  await po.appManagement.clickConnectSupabaseButton();
  // Wait for the fake OAuth return to finish resource loading before leaving
  // this screen. The connected project card is the terminal happy-path UI.
  await expect(po.page.getByText("Fake Supabase Project")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect(po.page.getByTestId("supabase-branch-select")).toBeVisible();
  await expect(po.page.getByTestId("connect-supabase-button")).toBeHidden();
  await po.navigation.clickBackButton();

  await po.sendPrompt("tc=generate-supabase-client");
  await po.snapshotAppFiles({ name: "supabase-client-generated" });
});
