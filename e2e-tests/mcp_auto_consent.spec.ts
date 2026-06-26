import path from "path";
import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import type { PageObject } from "./helpers/page-objects";

// Auto-approve safe MCP tools (agent mode, Pro). A fake classifier in the
// fake-llm-server decides off the tool name: destructive-sounding tools (e.g.
// delete_record) -> ask; everything else (e.g. calculator_add) -> allow.

async function addTestMcpServer(po: PageObject) {
  await po.navigation.goToSettingsTab();
  await po.page.getByRole("button", { name: "Tools (MCP)" }).click();
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
}

async function enableAutoApproveSafeMcpTools(po: PageObject) {
  await po.settings.scrollToSettingsSection("experiments");
  await po.page
    .getByRole("switch", { name: "Skip consent for safe MCP tools" })
    .click();
}

async function startAgentChat(po: PageObject) {
  await po.navigation.goToAppsTab();
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();
}

testSkipIfWindows(
  "mcp auto-consent - safe tool runs without a consent prompt",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await addTestMcpServer(po);
    await po.settings.waitForMcpTool("testing-mcp-server", "calculator_add");
    await enableAutoApproveSafeMcpTools(po);
    await startAgentChat(po);

    await po.sendPrompt("tc=local-agent/mcp-calculator", {
      skipWaitForCompletion: true,
    });

    // Auto-approved: chat completes and no consent banner ever appears.
    await po.chatActions.waitForChatCompletion();
    await expect(
      po.page.getByRole("button", { name: "Always allow" }),
    ).toHaveCount(0);
    // The tool-call card shows it was auto-approved, with the visible reason.
    await expect(po.page.getByText("Auto-approved")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(po.page.getByText("safe tool")).toBeVisible();
  },
);

testSkipIfWindows(
  "mcp auto-consent - destructive tool still asks for consent",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await addTestMcpServer(po);
    await po.settings.waitForMcpTool("testing-mcp-server", "delete_record");
    await enableAutoApproveSafeMcpTools(po);
    await startAgentChat(po);

    await po.sendPrompt("tc=local-agent/mcp-delete", {
      skipWaitForCompletion: true,
    });

    // Destructive tool -> classifier asks -> consent banner appears.
    await expect(
      po.page.getByRole("button", { name: "Always allow" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    // The consent prompt surfaces the classifier's reason.
    await expect(po.page.getByText(/Flagged for review/)).toBeVisible();
  },
);

testSkipIfWindows(
  "mcp auto-consent - gate off: setting disabled still asks",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await addTestMcpServer(po);
    await po.settings.waitForMcpTool("testing-mcp-server", "calculator_add");
    // Do NOT enable the setting; the classifier must not run.
    await startAgentChat(po);

    await po.sendPrompt("tc=local-agent/mcp-calculator", {
      skipWaitForCompletion: true,
    });

    // Setting off -> no auto-approval -> the normal consent banner appears.
    await expect(
      po.page.getByRole("button", { name: "Always allow" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
  },
);

// With sandbox script execution off, MCP tools are registered as direct agent
// tools instead of sandbox host functions. Auto-approval must work on that path
// too.
testSkipIfWindows(
  "mcp auto-consent - safe tool auto-approves with sandbox execution off",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await addTestMcpServer(po);
    await po.settings.waitForMcpTool("testing-mcp-server", "calculator_add");
    await po.settings.toggleSandboxScriptExecution();
    await enableAutoApproveSafeMcpTools(po);
    await startAgentChat(po);

    await po.sendPrompt("tc=local-agent/mcp-calculator-direct", {
      skipWaitForCompletion: true,
    });

    // Auto-approved via the direct-tool path: completes, no consent banner.
    await po.chatActions.waitForChatCompletion();
    await expect(
      po.page.getByRole("button", { name: "Always allow" }),
    ).toHaveCount(0);
  },
);
