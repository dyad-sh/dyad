import path from "path";
import { spawn } from "child_process";
import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows("mcp - oauth connects and calls a tool", async ({ po }) => {
  const fakePath = path.join(
    __dirname,
    "..",
    "testing",
    "fake-oauth-mcp-server.mjs",
  );
  const port = 4002;
  const base = `http://localhost:${port}`;

  const fake = spawn("node", [fakePath], {
    env: { ...process.env, PORT: String(port), FAKE_DCR: "1" },
    stdio: "pipe",
  });

  // Wait for the fake server to be ready by checking stdout for the
  // ready message. Mirrors the pattern in mcp.spec.ts.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("fake-oauth-mcp-server failed to start within timeout"));
    }, 10000);

    fake.stdout?.on("data", (data: Buffer) => {
      console.log("fake-oauth-mcp-server stdout:", data.toString());
      if (data.toString().includes("Fake OAuth MCP server listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    fake.stderr?.on("data", (data: Buffer) => {
      console.error("fake-oauth-mcp-server stderr:", data.toString());
    });

    fake.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  try {
    await po.setUp();

    // Drive the OAuth authorize URL via fetch (redirect:follow) so
    // the test doesn't open the OS browser. The fake's /authorize
    // auto-redirects to the loopback callback, and Dyad's listener
    // resolves the flow normally.
    await po.electronApp.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        await fetch(url, { redirect: "follow" });
      };
    });

    await po.navigation.goToSettingsTab();
    await po.settings.scrollToSettingsSection("experiments");
    await po.settings.toggleEnableMcpServersForBuildMode();
    await po.settings.scrollToSettingsSection("tools-mcp");

    await po.page
      .getByRole("textbox", { name: "My MCP Server" })
      .fill("testing-mcp-server");
    await po.page.getByTestId("mcp-transport-select").selectOption("http");
    await po.page.getByPlaceholder("http://localhost:3000").fill(`${base}/mcp`);
    await po.page.getByRole("switch", { name: "Use OAuth" }).click();
    await po.page.getByRole("button", { name: "Add Server" }).click();

    await po.page.getByRole("button", { name: "Connect" }).click();
    await expect(po.page.getByText("OAuth: connected")).toBeVisible({
      timeout: 15_000,
    });

    // Tool call uses the freshly stored bearer token.
    await po.navigation.goToAppsTab();
    await po.chatActions.selectChatMode("build");
    await po.sendPrompt("[call_tool=calculator_add]", {
      skipWaitForCompletion: true,
    });
    await po.agentConsent.waitForAgentConsentBanner();
    await po.snapshotMessages();
    await po.agentConsent.clickAgentConsentAlwaysAllow();
    await po.approveProposal();

    await po.sendPrompt("[dump]");
    await po.snapshotServerDump("all-messages");
  } finally {
    fake.kill();
    await new Promise<void>((resolve) => {
      fake.on("exit", () => resolve());
      setTimeout(() => {
        fake.kill("SIGKILL");
        resolve();
      }, 2000);
    });
  }
});
