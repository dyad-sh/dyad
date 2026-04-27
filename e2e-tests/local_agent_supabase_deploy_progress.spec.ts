import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows(
  "local-agent - shows Supabase deploy queue progress",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");

    await po.appManagement.getTitleBarAppNameButton().click();
    await po.appManagement.clickConnectSupabaseButton();
    await po.navigation.clickBackButton();

    await po.chatActions.selectLocalAgentMode();

    await po.sendPrompt("tc=local-agent/supabase-deploy-progress", {
      skipWaitForCompletion: true,
    });

    await expect(async () => {
      await expect(
        po.page
          .getByText(
            /Deploying Supabase functions: \d+\/20 complete \(\d+ active, \d+ queued\)/,
          )
          .or(po.page.getByText("Supabase functions deployed: 20/20 complete"))
          .first(),
      ).toBeVisible();
    }).toPass({ timeout: Timeout.LONG });

    await po.chatActions.waitForChatCompletion();

    await expect(
      po.page.getByText("Supabase functions deployed: 20/20 complete"),
    ).toBeVisible({ timeout: Timeout.LONG });
  },
);
