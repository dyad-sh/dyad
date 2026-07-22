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

    // 6 entries served; the non-npx stdio entry and the malformed one
    // must be dropped.
    await expect(po.page.getByTestId("catalog-card")).toHaveCount(4, {
      timeout: 15_000,
    });
    await expect(po.page.getByText("E2E Stdio Node Server")).toHaveCount(0);

    // The valid stdio entry renders with its package and a "Local" tag
    // instead of a hostname.
    const stdioCard = po.catalog.card("E2E Stdio Server");
    await expect(stdioCard).toBeVisible();
    await expect(stdioCard.getByText("Local", { exact: true })).toBeVisible();
    await expect(
      stdioCard.getByText("@dyad-sh/e2e-nonexistent-mcp@1.0.0"),
    ).toBeVisible();

    await po.catalog.search("OAuth");
    await expect(po.page.getByTestId("catalog-card")).toHaveCount(1);
    await po.catalog.search("");
    await expect(po.page.getByTestId("catalog-card")).toHaveCount(4);
  },
);

testSkipIfWindows(
  "catalog - one-click add of a stdio entry creates a local plugin",
  async ({ po }) => {
    await po.setUp();
    await po.navigation.goToPluginsTab();

    // Only the add flow is covered here: the entry's package
    // deliberately doesn't exist, so a spawn can't succeed. Stdio
    // connection itself is covered by mcp.spec.ts with a real local
    // server.
    await po.catalog.addFromCatalog("E2E Stdio Server");
    // The consent dialog shows the full command for inspection.
    await expect(
      po.page
        .getByRole("alertdialog")
        .getByText("npx -y @dyad-sh/e2e-nonexistent-mcp@1.0.0"),
    ).toBeVisible();
    await po.catalog.confirmStdioConsent();
    await po.catalog.expectAdded("E2E Stdio Server");
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
