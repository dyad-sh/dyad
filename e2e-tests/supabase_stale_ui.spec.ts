import { testSkipIfWindows } from "./helpers/test_helper";

// https://github.com/coney-sh/coney/issues/269
testSkipIfWindows("supabase - stale ui", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=add-supabase");
  await po.snapshotMessages();

  await po.page.getByText("Set up supabase").click();
  // On app details page:
  await po.appManagement.clickConnectSupabaseButton();
  // TODO: for some reason on Windows this navigates to the main (apps) page,
  // rather than the original chat page, so this test is skipped on Windows.
  // However, the underlying issue is platform-agnostic, so it seems OK to test
  // only on Mac.
  await po.navigation.clickBackButton();

  // On chat page:
  await po.snapshotMessages();

  // Create a second app; do NOT integrate it with Supabase, and make sure UI is correct.
  await po.navigation.goToAppsTab();
  await po.sendPrompt("tc=add-supabase");
  await po.snapshotMessages();
});
