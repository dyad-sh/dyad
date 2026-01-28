import path from "path";
import { spawn } from "child_process";
import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("mcp - call calculator", async ({ po }) => {
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

testSkipIfWindows("mcp - call calculator via http", async ({ po }) => {
  const httpMcpServerPath = path.join(
    __dirname,
    "..",
    "testing",
    "fake-http-mcp-server.mjs",
  );
  console.log("Starting HTTP MCP server at:", httpMcpServerPath);

  const httpServerProcess = spawn("node", [httpMcpServerPath], {
    env: { ...process.env, PORT: "3002" },
    stdio: "pipe",
  });

  // Wait for the HTTP server to be ready by checking stdout for the ready message
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("HTTP MCP server failed to start within timeout"));
    }, 10000);

    httpServerProcess.stdout?.on("data", (data: Buffer) => {
      console.log("HTTP MCP server stdout:", data.toString());
      if (data.toString().includes("HTTP MCP server running")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    httpServerProcess.stderr?.on("data", (data: Buffer) => {
      console.error("HTTP MCP server stderr:", data.toString());
    });

    httpServerProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  try {
    await po.setUp();
    await po.goToSettingsTab();
    await po.page.getByRole("button", { name: "Tools (MCP)" }).click();

    // Fill in server name
    await po.page
      .getByRole("textbox", { name: "My MCP Server" })
      .fill("testing-mcp-server");

    await po.page.getByTestId("mcp-transport-select").selectOption("http");

    const urlInput = po.page.getByPlaceholder("http://localhost:3000");
    await expect(urlInput).toBeVisible();
    await urlInput.fill("http://localhost:3002/mcp");

    await po.page.getByRole("button", { name: "Add Server" }).click();

    // Wait for the server to be created and the "Add Header" button to become visible
    const addHeaderButton = po.page.getByRole("button", { name: "Add Header" });
    await expect(addHeaderButton).toBeVisible({ timeout: 10000 });
    await addHeaderButton.click();
    await po.page.getByRole("textbox", { name: "Key" }).fill("Authorization");
    await po.page.getByRole("textbox", { name: "Value" }).fill("testValue1");
    await po.page.getByRole("button", { name: "Save" }).click();
    await po.goToSettingsTab();
    await po.page.getByRole("button", { name: "Tools (MCP)" }).click();
    await po.goToAppsTab();
    await po.selectChatMode("agent");
    await po.sendPrompt("[call_tool=calculator_add]", {
      skipWaitForCompletion: true,
    });
    const alwaysAllowButton = po.page.getByRole("button", {
      name: "Allow once",
    });
    await expect(alwaysAllowButton).toBeVisible();
    await po.snapshotMessages();
    await alwaysAllowButton.click();
    await po.page.getByRole("button", { name: "Approve" }).click();

    await po.sendPrompt("[dump]");
    await po.snapshotServerDump("all-messages");
  } finally {
    // Clean up: kill the HTTP server process
    httpServerProcess.kill();
    await new Promise<void>((resolve) => {
      httpServerProcess.on("exit", () => resolve());
      // Force kill after 2 seconds if it doesn't exit gracefully
      setTimeout(() => {
        httpServerProcess.kill("SIGKILL");
        resolve();
      }, 2000);
    });
  }
});
