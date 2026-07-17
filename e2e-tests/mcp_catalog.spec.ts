import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

function waitForReady(
  child: ChildProcess,
  readyText: string,
  label: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} failed to start within timeout`));
    }, 10_000);
    child.stdout?.on("data", (data: Buffer) => {
      if (data.toString().includes(readyText)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    // Fail fast if the process dies before it is ready, instead of
    // hanging until the timeout with a generic message.
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `${label} exited before ready (code=${code} signal=${signal})`,
        ),
      );
    });
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2000);
  });
}

testSkipIfWindows(
  "catalog - renders supported entries and filters by search",
  async ({ po }) => {
    await po.setUp();
    await po.navigation.goToPluginsTab();

    // 5 entries served; the stdio and malformed ones must be dropped.
    await expect(po.page.getByTestId("catalog-card")).toHaveCount(3, {
      timeout: 15_000,
    });
    await expect(po.page.getByText("E2E Stdio Server")).toHaveCount(0);

    await po.catalog.search("OAuth");
    await expect(po.page.getByTestId("catalog-card")).toHaveCount(1);
    await po.catalog.search("");
    await expect(po.page.getByTestId("catalog-card")).toHaveCount(3);
  },
);

testSkipIfWindows(
  "catalog - one-click add without oauth discovers tools",
  async ({ po }) => {
    const httpServer = spawn(
      "node",
      [path.join(__dirname, "..", "testing", "fake-http-mcp-server.mjs")],
      { env: { ...process.env, PORT: "3002" }, stdio: "pipe" },
    );
    await waitForReady(httpServer, "HTTP MCP server running", "http server");

    try {
      await po.setUp();
      await po.navigation.goToPluginsTab();

      await po.catalog.addFromCatalog("E2E Open Server");
      await po.catalog.expectAdded("E2E Open Server");
      await po.plugins.waitForTool("E2E Open Server", "calculator_add");
    } finally {
      await stop(httpServer);
    }
  },
);

testSkipIfWindows(
  "catalog - one-click add runs the oauth flow to connected",
  async ({ po }) => {
    const oauthServer = spawn(
      "node",
      [path.join(__dirname, "..", "testing", "fake-oauth-mcp-server.mjs")],
      { env: { ...process.env, PORT: "4010", FAKE_DCR: "1" }, stdio: "pipe" },
    );
    await waitForReady(
      oauthServer,
      "Fake OAuth MCP server listening",
      "oauth server",
    );

    try {
      await po.setUp();
      // Complete the browser leg of OAuth without opening a browser.
      await po.electronApp.evaluate(({ shell }) => {
        shell.openExternal = async (url) => {
          await fetch(url, { redirect: "follow" });
        };
      });
      await po.navigation.goToPluginsTab();

      await po.catalog.addFromCatalog("E2E OAuth Server");
      await po.catalog.expectAdded("E2E OAuth Server");
      await expect(po.page.getByText("OAuth: connected")).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await stop(oauthServer);
    }
  },
);
