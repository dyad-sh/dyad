import path from "path";
import { spawn } from "child_process";
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
  await po.page.getByRole("button", { name: "Approve" }).click();

  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("all-messages");
});

test("mcp - call calculator with HTTP transport and authorization", async ({
  po,
}) => {
  // Start the fake HTTP MCP server
  const testAuthValue = "test-auth-token-123";
  const serverPath = path.join(
    __dirname,
    "..",
    "testing",
    "fake-http-mcp-server.mjs",
  );
  const serverProcess = spawn("node", [serverPath], {
    env: { ...process.env, EXPECTED_AUTH_VALUE: testAuthValue, PORT: "3001" },
    stdio: "pipe",
  });

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    await po.setUp();
    await po.goToSettingsTab();
    await po.page.getByRole("button", { name: "Tools (MCP)" }).click();

    await po.page
      .getByRole("textbox", { name: "My MCP Server" })
      .fill("testing-http-mcp-server");
    await po.page.locator("select").first().selectOption("http");
    // Wait for URL field to appear after selecting HTTP transport
    // Use placeholder to find it since label association might not work immediately
    await po.page
      .getByPlaceholder("http://localhost:3000")
      .waitFor({ state: "visible" });
    await po.page
      .getByPlaceholder("http://localhost:3000")
      .fill("http://localhost:3001");
    await po.page.getByRole("button", { name: "Add Server" }).click();
    // Wait for server to be added and "Add Header" button to appear
    await po.page
      .getByRole("button", { name: "Add Header" })
      .waitFor({ state: "visible" });
    await po.page.getByRole("button", { name: "Add Header" }).click();
    await po.page.getByRole("textbox", { name: "Key" }).fill("Authorization");
    await po.page.getByRole("textbox", { name: "Value" }).fill(testAuthValue);
    await po.page.getByRole("button", { name: "Save" }).click();
    await po.goToAppsTab();
    await po.selectChatMode("agent");
    // Wait for chat input to be ready
    await po.getChatInput().waitFor({ state: "visible" });
    await po.sendPrompt("[call_tool=calculator_add_2]", {
      skipWaitForCompletion: true,
    });
    await po.page.getByRole("button", { name: "Approve" }).click();
    await po.sendPrompt("[dump]");
    await po.page.waitForTimeout(1000);
    await po.snapshotServerDump("all-messages");
  } finally {
    // Clean up server process
    serverProcess.kill();
    await new Promise((resolve) => {
      serverProcess.on("exit", resolve);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGTERM");
      }
    });
  }
});
