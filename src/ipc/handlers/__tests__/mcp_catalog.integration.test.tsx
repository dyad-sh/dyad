// Drives the curated-catalog section of the Plugins page over the
// real mcp:* IPC handlers: the catalog is served by a local HTTP
// server, the entry points at a real fake MCP server, and adding it
// goes through the real add-from-catalog flow.
import http from "node:http";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { ipc } from "@/ipc/types";
import { clearMcpCatalogCacheForTests } from "@/ipc/shared/remote_mcp_catalog";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("Plugins catalog (integration)", () => {
  let harness: HybridChatHarness;
  let catalogServer: http.Server;
  let mcpServerProcess: ChildProcess;
  let mcpPort: number;

  beforeAll(async () => {
    // A real fake MCP server for the catalog entry to point at.
    mcpServerProcess = spawn(
      "node",
      [path.join(process.cwd(), "testing", "fake-http-mcp-server.mjs")],
      { env: { ...process.env, PORT: "0" }, stdio: "pipe" },
    );
    mcpPort = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("MCP server start timeout")),
        10_000,
      );
      let buffer = "";
      mcpServerProcess.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const match = buffer.match(
          /HTTP MCP server running on http:\/\/localhost:(\d+)\/mcp/,
        );
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
      mcpServerProcess.once("error", reject);
    });

    // A local catalog endpoint serving one addable entry.
    catalogServer = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          servers: [
            {
              slug: "integration-open",
              name: "Integration Open Server",
              category: "Testing",
              transport: "http",
              url: `http://localhost:${mcpPort}/mcp`,
              oauth: "none",
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      catalogServer.listen(0, "127.0.0.1", resolve),
    );
    const address = catalogServer.address();
    if (typeof address === "object" && address) {
      process.env.DYAD_MCP_CATALOG_URL = `http://127.0.0.1:${address.port}/`;
    }

    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: {
        isTestMode: true,
        enableMcpServersForBuildMode: true,
      },
    });
  }, 60_000);

  beforeEach(async () => {
    clearMcpCatalogCacheForTests();
    const servers = await ipc.mcp.listServers();
    for (const server of servers) {
      await ipc.mcp.deleteServer(server.id);
    }
  });

  afterAll(async () => {
    delete process.env.DYAD_MCP_CATALOG_URL;
    await harness?.dispose();
    catalogServer?.close();
    mcpServerProcess?.kill();
  });

  it("adds a catalog entry with one click and discovers its tools", async () => {
    harness.mountSurface({ route: "/plugins" });

    const card = await screen.findByTestId("catalog-card");
    expect(card.textContent).toContain("Integration Open Server");

    fireEvent.click(within(card).getByRole("button", { name: "Add" }));

    // Added state on the catalog card, server row in the list above.
    await within(card).findByText("Added");
    const servers = await ipc.mcp.listServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].catalogSlug).toBe("integration-open");

    // Tool discovery completes against the real fake MCP server.
    await waitFor(
      async () => {
        const result = await ipc.mcp.listTools(servers[0].id);
        expect(result.status).toBe("ok");
        expect(result.tools.map((t) => t.name)).toContain("calculator_add");
      },
      { timeout: 15_000 },
    );

    // The configured plugin's summary card carries the catalog badge.
    const pluginCard = await screen.findByTestId("plugin-card");
    expect(pluginCard.textContent).toContain("Catalog");

    // Tools and Delete live on the detail page.
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open Integration Open Server",
      }),
    );
    const detail = await screen.findByTestId("plugin-detail");
    await within(detail).findByText("calculator_add", {}, { timeout: 15_000 });
    expect(detail.textContent).toContain("Catalog");

    // Deleting the plugin makes the catalog entry addable again.
    fireEvent.click(within(detail).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    await waitFor(async () => {
      expect(await ipc.mcp.listServers()).toHaveLength(0);
    });
    // Navigating back remounts the catalog; re-find the card (the
    // earlier reference is detached) and confirm it is addable again.
    await waitFor(async () => {
      const readdable = await screen.findByTestId("catalog-card");
      within(readdable).getByRole("button", { name: "Add" });
    });
  }, 40_000);
});
