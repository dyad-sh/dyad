import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("supabase client is generated", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.appManagement.importApp("minimal");
  await po.chatActions.sendPrompt("tc=add-supabase");

  // Connect to Supabase
  await po.page.getByText("Set up supabase").click();
  await po.appManagement.clickConnectSupabaseButton();
  await po.navigation.clickBackButton();

  await po.chatActions.sendPrompt("tc=generate-supabase-client");
  await po.snapshotAppFiles({ name: "supabase-client-generated" });
});
