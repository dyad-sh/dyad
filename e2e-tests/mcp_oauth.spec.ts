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
  // ready message. Mirrors the MCP HTTP fake-server startup pattern used by
  // the hybrid MCP integration tests.
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
    await po.setUpDyadPro({ localAgent: true });

    // Drive the OAuth authorize URL via fetch (redirect:follow) so
    // the test doesn't open the OS browser. The fake's /authorize
    // auto-redirects to the loopback callback, and Dyad's listener
    // resolves the flow normally.
    await po.electronApp.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        await fetch(url, { redirect: "follow" });
      };
    });

    await po.navigation.goToPluginsTab();
    await po.plugins.openAddPluginDialog();

    await po.page
      .getByRole("textbox", { name: "My MCP Server" })
      .fill("testing-mcp-server");
    await po.page.getByTestId("mcp-transport-select").selectOption("http");
    await po.page.getByPlaceholder("http://localhost:3000").fill(`${base}/mcp`);
    await po.plugins.submitAddPluginDialog();
    await expect(po.page.getByText("OAuth: connected")).toBeVisible({
      timeout: 15_000,
    });

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

// Manual (non-DCR) variant: fake server requires pre-registered
// client_id + client_secret typed into the Advanced accordion.
testSkipIfWindows(
  "mcp - oauth manual (non-DCR) connects and calls a tool",
  async ({ po }) => {
    const fakePath = path.join(
      __dirname,
      "..",
      "testing",
      "fake-oauth-mcp-server.mjs",
    );
    const port = 4003;
    const base = `http://localhost:${port}`;
    const clientId = "preregistered-client";
    const clientSecret = "preregistered-secret";

    const fake = spawn("node", [fakePath], {
      env: {
        ...process.env,
        PORT: String(port),
        FAKE_DCR: "0",
        FAKE_CLIENT_ID: clientId,
        FAKE_CLIENT_SECRET: clientSecret,
      },
      stdio: "pipe",
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error("fake-oauth-mcp-server failed to start within timeout"),
        );
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
      await po.setUpDyadPro({ localAgent: true });

      await po.electronApp.evaluate(({ shell }) => {
        shell.openExternal = async (url) => {
          await fetch(url, { redirect: "follow" });
        };
      });

      await po.navigation.goToPluginsTab();
      await po.plugins.openAddPluginDialog();

      await po.page
        .getByRole("textbox", { name: "My MCP Server" })
        // Fake LLM hardcodes server name `testing-mcp-server`.
        .fill("testing-mcp-server");
      await po.page.getByTestId("mcp-transport-select").selectOption("http");
      await po.page
        .getByPlaceholder("http://localhost:3000")
        .fill(`${base}/mcp`);
      await po.page
        .getByRole("button", { name: "Advanced OAuth options" })
        .click();
      await po.page.getByPlaceholder("Pre-registered client ID").fill(clientId);
      await po.page
        .getByPlaceholder("Pre-registered client secret")
        .fill(clientSecret);
      await po.plugins.submitAddPluginDialog();

      await expect(po.page.getByText("OAuth: connected")).toBeVisible({
        timeout: 15_000,
      });

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
  },
);

testSkipIfWindows(
  "mcp - oauth disable-and-retry when server doesn't support OAuth",
  async ({ po }) => {
    // The fake server starts in NO_OAUTH mode: every OAuth endpoint
    // 404s and /mcp serves requests without a bearer. Default-on OAuth
    // means Add Server kicks off auto-connect, discovery 404s, and the
    // "Server doesn't support OAuth" alert appears with the
    // Disable OAuth & retry button. Clicking it must clear the alert
    // and leave the server usable.
    const fakePath = path.join(
      __dirname,
      "..",
      "testing",
      "fake-oauth-mcp-server.mjs",
    );
    const port = 4004;
    const base = `http://localhost:${port}`;

    const fake = spawn("node", [fakePath], {
      env: { ...process.env, PORT: String(port), FAKE_NO_OAUTH: "1" },
      stdio: "pipe",
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error("fake-oauth-mcp-server failed to start within timeout"),
        );
      }, 10000);
      fake.stdout?.on("data", (data: Buffer) => {
        if (data.toString().includes("Fake OAuth MCP server listening")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      fake.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    try {
      await po.setUpDyadPro({ localAgent: true });
      // Stub openExternal so an unintended browser pop is harmless; the
      // discovery 404 should bail before any redirect would happen.
      await po.electronApp.evaluate(({ shell }) => {
        shell.openExternal = async (url) => {
          await fetch(url, { redirect: "follow" });
        };
      });

      await po.navigation.goToPluginsTab();
      await po.plugins.openAddPluginDialog();

      await po.page
        .getByRole("textbox", { name: "My MCP Server" })
        .fill("testing-mcp-server");
      await po.page.getByTestId("mcp-transport-select").selectOption("http");
      await po.page
        .getByPlaceholder("http://localhost:3000")
        .fill(`${base}/mcp`);
      await po.plugins.submitAddPluginDialog();

      // Toast fires once at registration and auto-dismisses; assert it
      // before the persistent panel below.
      await po.toastNotifications.waitForToastWithText(
        "OAuth connection failed. This server doesn't support OAuth.",
      );

      // The full alert with the retry action lives on the detail page.
      await po.plugins.openPluginDetail("testing-mcp-server");
      await expect(
        po.page.getByText("Server doesn't support OAuth", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      await po.page
        .getByRole("button", { name: "Disable OAuth & retry" })
        .click();

      await expect(
        po.page.getByText("Server doesn't support OAuth", { exact: true }),
      ).toBeHidden({ timeout: 15_000 });

      // Drive a tool call to prove the server is actually usable now.
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
  },
);

testSkipIfWindows(
  "mcp - oauth enable-and-retry when server requires authentication",
  async ({ po }) => {
    // The fake server is the normal OAuth-protected one. The user
    // creates the server with OAuth toggled OFF; the post-create probe
    // hits /mcp without a bearer, gets a 401, and the
    // "Server requires authentication" alert appears with the
    // Enable OAuth & retry button. Clicking it must run the full OAuth
    // flow and reach the connected state.
    const fakePath = path.join(
      __dirname,
      "..",
      "testing",
      "fake-oauth-mcp-server.mjs",
    );
    const port = 4005;
    const base = `http://localhost:${port}`;

    const fake = spawn("node", [fakePath], {
      env: { ...process.env, PORT: String(port), FAKE_DCR: "1" },
      stdio: "pipe",
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error("fake-oauth-mcp-server failed to start within timeout"),
        );
      }, 10000);
      fake.stdout?.on("data", (data: Buffer) => {
        if (data.toString().includes("Fake OAuth MCP server listening")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      fake.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    try {
      await po.setUpDyadPro({ localAgent: true });
      await po.electronApp.evaluate(({ shell }) => {
        shell.openExternal = async (url) => {
          await fetch(url, { redirect: "follow" });
        };
      });

      await po.navigation.goToPluginsTab();
      await po.plugins.openAddPluginDialog();

      await po.page
        .getByRole("textbox", { name: "My MCP Server" })
        .fill("testing-mcp-server");
      await po.page.getByTestId("mcp-transport-select").selectOption("http");
      await po.page
        .getByPlaceholder("http://localhost:3000")
        .fill(`${base}/mcp`);
      // Toggle "Use OAuth" off so the post-create probe runs instead
      // of auto-connect; this is the entry point for the unauthorized
      // retry flow.
      await po.page.getByRole("switch", { name: "Use OAuth" }).click();
      await po.plugins.submitAddPluginDialog();

      await po.toastNotifications.waitForToastWithText(
        "Server connection failed. This server requires authentication. Try enabling OAuth.",
      );

      // The full alert with the retry action lives on the detail page.
      await po.plugins.openPluginDetail("testing-mcp-server");
      await expect(
        po.page.getByText("Server requires authentication", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      await po.page
        .getByRole("button", { name: "Enable OAuth & retry" })
        .click();

      await expect(po.page.getByText("OAuth: connected")).toBeVisible({
        timeout: 15_000,
      });
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
  },
);
