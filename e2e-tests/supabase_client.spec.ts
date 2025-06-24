import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("supabase client is generated", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.sendPrompt("tc=add-supabase");

  // Connect to Supabase
  await po.page.getByText("Set up supabase").click();
  await po.clickConnectSupabaseButton();
  await po.clickBackButton();

  await po.sendPrompt("tc=generate-supabase-client");
  await po.snapshotAppFiles({ name: "supabase-client-generated" });
});
