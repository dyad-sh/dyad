import path from "path";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * Test for security review in local-agent mode
 */
testSkipIfWindows("local-agent - security review fix", async ({ po }) => {
  await po.setUpConeyPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  // First, trigger a security review
  await po.previewPanel.selectPreviewMode("security");
  await po.securityReview.clickRunSecurityReview();

  await po.snapshotServerDump("all-messages");
});

/**
 * Test for mention apps feature in local-agent mode
 */
testSkipIfWindows("local-agent - mention apps", async ({ po }) => {
  await po.setUpConeyPro({ localAgent: true });

  // Import app and reference it.
  await po.importApp("minimal-with-ai-rules");
  await po.navigation.goToAppsTab();
  await po.chatActions.selectLocalAgentMode();

  // Use @app:minimal-with-ai-rules to reference the other app
  await po.sendPrompt("[dump] @app:minimal-with-ai-rules hi");

  await po.snapshotServerDump("request");
});

/**
 * Test for MCP tool calls in local-agent mode
 */
testSkipIfWindows("local-agent - mcp tool call", async ({ po }) => {
  await po.setUpConeyPro({ localAgent: true });
  await po.navigation.goToSettingsTab();
  await po.page.getByRole("button", { name: "Tools (MCP)" }).click();

  // Configure the test MCP server
  await po.page
    .getByRole("textbox", { name: "My MCP Server" })
    .fill("testing-mcp-server");
  await po.page.getByRole("textbox", { name: "node" }).fill("node");
  const testMcpServerPath = path.join(
    __dirname,
    "..",
    "testing",
    "fake-stdio-mcp-server.mjs",
  );
  await po.page
    .getByRole("textbox", { name: "path/to/mcp-server.js --flag" })
    .fill(testMcpServerPath);
  await po.page.getByRole("button", { name: "Add Server" }).click();

  await po.navigation.goToAppsTab();
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  // Send prompt that triggers MCP tool call
  await po.sendPrompt("tc=local-agent/mcp-calculator", {
    skipWaitForCompletion: true,
  });

  // MCP tools require consent - wait for the consent banner
  await po.agentConsent.waitForAgentConsentBanner();
  await po.agentConsent.clickAgentConsentAlwaysAllow();

  // Wait for chat to complete
  await po.chatActions.waitForChatCompletion();

  await po.snapshotMessages();
});
