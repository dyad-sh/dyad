import { expect } from "@playwright/test";
import { spawn, type ChildProcess } from "child_process";
import path from "path";

import { testSkipIfWindows } from "./helpers/test_helper";

async function stopProcess(process: ChildProcess): Promise<void> {
  process.kill();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      process.kill("SIGKILL");
      resolve();
    }, 2_000);
    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

testSkipIfWindows("mcp - call calculator", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.navigation.goToPluginsTab();
  await po.plugins.openAddPluginDialog();

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
  await po.plugins.submitAddPluginDialog();

  // Environment variables are edited on the plugin's detail page.
  await po.plugins.openPluginDetail("testing-mcp-server");
  const detail = po.page.getByTestId("plugin-detail");
  await detail
    .getByRole("button", { name: "Add Environment Variable" })
    .click();
  await detail.getByRole("textbox", { name: "Key" }).fill("testKey1");
  await detail.getByRole("textbox", { name: "Value" }).fill("testValue1");
  await detail.getByRole("button", { name: "Save" }).click();
  await po.plugins.waitForToolInDetail("calculator_add");

  await po.navigation.goToAppsTab();
  await po.chatActions.selectChatMode("local-agent");
  await po.sendPrompt("tc=local-agent/mcp-calculator", {
    skipWaitForCompletion: true,
  });
  await po.agentConsent.waitForAgentConsentBanner();

  await po.snapshotMessages();
  await po.agentConsent.clickAgentConsentAlwaysAllow();
  await po.chatActions.waitForChatCompletion();
  await expect(po.page.getByText(/The sum of 5 and 3 is 8/)).toBeVisible();
});

testSkipIfWindows("mcp - call calculator via http", async ({ po }) => {
  const httpMcpServerPath = path.join(
    __dirname,
    "..",
    "testing",
    "fake-http-mcp-server.mjs",
  );
  const httpServerProcess = spawn("node", [httpMcpServerPath], {
    env: { ...process.env, PORT: "0" },
    stdio: "pipe",
  });

  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("HTTP MCP server failed to start within timeout"));
    }, 10_000);

    httpServerProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      const match = output.match(/localhost:(\d+)\/mcp/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    httpServerProcess.stderr?.on("data", (data: Buffer) => {
      console.error("HTTP MCP server stderr:", data.toString());
    });
    httpServerProcess.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  try {
    await po.setUpDyadPro({ localAgent: true });
    await po.navigation.goToPluginsTab();
    await po.plugins.openAddPluginDialog();

    await po.page
      .getByRole("textbox", { name: "My MCP Server" })
      .fill("testing-mcp-server");
    await po.page.getByTestId("mcp-transport-select").selectOption("http");
    await po.page
      .getByPlaceholder("http://localhost:3000")
      .fill(`http://localhost:${port}/mcp`);
    await po.page.getByRole("switch", { name: "Use OAuth" }).click();
    await po.plugins.submitAddPluginDialog();

    // Headers are edited on the plugin's detail page.
    await po.plugins.openPluginDetail("testing-mcp-server");
    const detail = po.page.getByTestId("plugin-detail");
    await detail.getByRole("button", { name: "Add Header" }).click();
    await detail.getByRole("textbox", { name: "Key" }).fill("Authorization");
    await detail.getByRole("textbox", { name: "Value" }).fill("testValue1");
    await detail.getByRole("button", { name: "Save" }).click();
    await po.plugins.waitForToolInDetail("calculator_add");

    await po.navigation.goToAppsTab();
    await po.chatActions.selectChatMode("local-agent");
    await po.sendPrompt("tc=local-agent/mcp-calculator", {
      skipWaitForCompletion: true,
    });
    await po.agentConsent.waitForAgentConsentBanner();
    await po.snapshotMessages();
    await po.agentConsent.clickAgentConsentAllowOnce();
    await po.chatActions.waitForChatCompletion();
    await expect(po.page.getByText(/The sum of 5 and 3 is 8/)).toBeVisible();
  } finally {
    await stopProcess(httpServerProcess);
  }
});
