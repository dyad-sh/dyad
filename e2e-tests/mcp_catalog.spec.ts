import { expect } from "@playwright/test";
import {
  startFakeHttpMcpServer,
  startFakeOauthMcpServer,
} from "./helpers/fake_mcp_server";
import { testSkipIfWindows } from "./helpers/test_helper";

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
    const stopHttpServer = await startFakeHttpMcpServer();

    try {
      await po.setUp();
      await po.navigation.goToPluginsTab();

      await po.catalog.addFromCatalog("E2E Open Server");
      await po.catalog.expectAdded("E2E Open Server");
      await po.plugins.waitForTool("E2E Open Server", "calculator_add");
    } finally {
      await stopHttpServer();
    }
  },
);

testSkipIfWindows(
  "catalog - one-click add runs the oauth flow to connected",
  async ({ po }) => {
    const stopOauthServer = await startFakeOauthMcpServer();

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
      // Adding an OAuth entry lands on the new server's page, so the
      // connect reports progress where the user is already looking.
      await expect(po.page.getByTestId("plugin-detail")).toBeVisible();
      await expect(po.page.getByText("OAuth: connected")).toBeVisible({
        timeout: 15_000,
      });

      // Back on the catalog the entry reads as added, not as pending.
      await po.navigation.goToPluginsTab();
      await po.catalog.expectAdded("E2E OAuth Server");
    } finally {
      await stopOauthServer();
    }
  },
);
