import path from "path";
import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("mcp - call calculator", async ({ po }) => {
  await po.setUp();
  await po.goToSettingsTab();
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
  console.log("testMcpServerPath", testMcpServerPath);
  await po.page
    .getByRole("textbox", { name: "path/to/mcp-server.js --flag" })
    .fill(testMcpServerPath);
  await po.page.getByRole("button", { name: "Add Server" }).click();
  await po.page
    .getByRole("button", { name: "Add Environment Variable" })
    .click();
  await po.page.getByRole("textbox", { name: "Key" }).fill("testKey1");
  await po.page.getByRole("textbox", { name: "Value" }).fill("testValue1");
  await po.page.getByRole("button", { name: "Save" }).click();
  await po.goToAppsTab();
  await po.selectChatMode("agent");
  await po.sendPrompt("[call_tool=calculator_add]", {
    skipWaitForCompletion: true,
  });

  // Wait for consent dialog to appear
  const alwaysAllowButton = po.page.getByRole("button", {
    name: "Always allow",
  });
  await expect(alwaysAllowButton).toBeVisible();

  // Make sure the tool call doesn't execute until consent is given
  await po.snapshotMessages();
  await alwaysAllowButton.click();

  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("all-messages");
});
