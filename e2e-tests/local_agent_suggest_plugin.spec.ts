import { expect } from "@playwright/test";
import { startFakeHttpMcpServer } from "./helpers/fake_mcp_server";
import { FAKE_LLM_BASE_PORT } from "./helpers/test-ports";
import { Timeout, testWithConfigSkipIfWindows } from "./helpers/test_helper";

/**
 * End-to-end guard for the `suggest_plugin` round trip.
 *
 * The local-agent tool parks the turn on a user-input request and renders a
 * suggestion card. One click adds the catalog plugin; the response arms a
 * follow-up turn that carries the agent's reason, so the conversation resumes
 * on a turn that can see the new plugin's tools instead of stopping dead.
 *
 * The fake catalog serves nothing featured by default, which keeps the tool
 * out of every other local-agent request snapshot; this launch opts in.
 */
const originalCatalogUrl = process.env.DYAD_MCP_CATALOG_URL;
// The catalog spec binds the default MCP port, and another worker can be
// running it at the same time, so this file's server gets its own port
// per worker and the catalog entry is pointed at it.
const MCP_PORT_BASE = 3100;
let mcpPort = MCP_PORT_BASE;
const testWithFeaturedCatalog = testWithConfigSkipIfWindows({
  preLaunchHook: async ({ fakeLlmPort }) => {
    mcpPort = MCP_PORT_BASE + (fakeLlmPort - FAKE_LLM_BASE_PORT);
    process.env.DYAD_MCP_CATALOG_URL = `http://localhost:${fakeLlmPort}/api/mcp-catalog?featured=e2e-open&mcpPort=${mcpPort}`;
  },
  postLaunchHook: async () => {
    if (originalCatalogUrl === undefined)
      delete process.env.DYAD_MCP_CATALOG_URL;
    else process.env.DYAD_MCP_CATALOG_URL = originalCatalogUrl;
  },
});

testWithFeaturedCatalog(
  "local-agent - connecting a suggested plugin resumes the chat",
  async ({ po }) => {
    // The card only reports a plugin as connected once its server answers,
    // so the entry's target has to be up.
    const stopMcpServer = await startFakeHttpMcpServer(mcpPort);
    try {
      await po.setUpDyadPro({ localAgent: true, autoApprove: true });
      await po.importApp("minimal");
      await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
      await po.chatActions.clickNewChat();
      await po.chatActions.selectLocalAgentMode();

      // The tool parks the turn on a user-input request rather than finishing
      // the conversation, so wait for the card it renders instead of chat
      // completion.
      await po.sendPrompt("tc=local-agent/suggest-plugin", {
        skipWaitForCompletion: true,
      });

      const messages = po.page.getByTestId("messages-list");
      const card = messages.getByTestId("plugin-suggestion-card");
      await expect(card).toBeVisible({ timeout: Timeout.LONG });
      await expect(card.getByText("Connect E2E Open Server?")).toBeVisible();
      await expect(
        card.getByText("Run the calculator tool to verify the totals."),
      ).toBeVisible();

      // One click adds the plugin (no OAuth for this entry) and answers the
      // request; the armed follow-up is dispatched as a real turn.
      await card.getByTestId("plugin-suggestion-connect-button").click();
      await expect(
        messages.getByTestId("plugin-suggestion-connected"),
      ).toBeVisible({ timeout: Timeout.MEDIUM });
      await expect(
        messages.getByText(
          "Continue. I have connected the E2E Open Server plugin. Resume what you needed it for: Run the calculator tool to verify the totals.",
        ),
      ).toBeVisible({ timeout: Timeout.LONG });
      await expect(
        messages.getByText("Carrying on from here.").last(),
      ).toBeVisible({ timeout: Timeout.LONG });
      await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });

      // The plugin now exists as an added, discovered catalog entry. A
      // featured entry is listed in both the Featured section and its
      // category, so scope the check to one of them.
      await po.navigation.goToPluginsTab();
      await expect(
        po.page
          .getByTestId("catalog-featured")
          .getByTestId("catalog-card")
          .filter({
            has: po.page.getByText("E2E Open Server", { exact: true }),
          })
          .getByText("Added"),
      ).toBeVisible({ timeout: Timeout.MEDIUM });
      await po.plugins.waitForTool("E2E Open Server", "calculator_add");
    } finally {
      await stopMcpServer();
    }
  },
);

testWithFeaturedCatalog(
  "local-agent - declining a suggested plugin continues without it",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true, autoApprove: true });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await po.chatActions.clickNewChat();
    await po.chatActions.selectLocalAgentMode();

    await po.sendPrompt("tc=local-agent/suggest-plugin", {
      skipWaitForCompletion: true,
    });

    const messages = po.page.getByTestId("messages-list");
    const card = messages.getByTestId("plugin-suggestion-card");
    await expect(card).toBeVisible({ timeout: Timeout.LONG });

    await card.getByTestId("plugin-suggestion-decline-button").click();
    await expect(messages.getByText("Skipped E2E Open Server")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    // Declining settles in place: the same turn carries on, with no
    // follow-up user message.
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await expect(messages.getByText("Carrying on from here.")).toBeVisible();
    await expect(
      messages.getByText(/^Continue\. I have connected/),
    ).toHaveCount(0);
  },
);

testWithFeaturedCatalog(
  "local-agent - opting out of a suggested plugin continues without it",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true, autoApprove: true });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await po.chatActions.clickNewChat();
    await po.chatActions.selectLocalAgentMode();

    await po.sendPrompt("tc=local-agent/suggest-plugin", {
      skipWaitForCompletion: true,
    });

    const messages = po.page.getByTestId("messages-list");
    const card = messages.getByTestId("plugin-suggestion-card");
    await expect(card).toBeVisible({ timeout: Timeout.LONG });

    await card.getByTestId("plugin-suggestion-never-button").click();
    await expect(messages.getByTestId("plugin-suggestion-never")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    // Opting out settles in place like a decline: the same turn carries on.
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await expect(messages.getByText("Carrying on from here.")).toBeVisible();
    await expect(
      messages.getByText(/^Continue\. I have connected/),
    ).toHaveCount(0);
  },
);
