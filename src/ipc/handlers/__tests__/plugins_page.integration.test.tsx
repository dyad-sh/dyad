// Drives the Plugins page and plugin detail page over the real mcp:*
// IPC handlers: add a plugin through the dialog, open its detail page,
// change a tool consent, and delete it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { ipc } from "@/ipc/types";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

describe("Plugins page (integration)", () => {
  let harness: HybridChatHarness;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: {
        isTestMode: true,
        enableMcpServersForBuildMode: true,
      },
    });
  }, 60_000);

  beforeEach(async () => {
    await harness.mcp.resetServers();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  it("adds a stdio plugin through the dialog and shows a summary card", async () => {
    harness.mountSurface({ route: "/plugins" });

    await screen.findByText("No plugins added yet.");

    fireEvent.click(screen.getByRole("button", { name: "Add Plugin" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Plugin" });
    fireEvent.change(within(dialog).getByPlaceholderText("My MCP Server"), {
      target: { value: "testing-mcp-server" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText("node"), {
      target: { value: "node" },
    });
    fireEvent.change(
      within(dialog).getByPlaceholderText("path/to/mcp-server.js --flag"),
      { target: { value: harness.mcp.fakeStdioServerPath } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Plugin" }));

    const card = await screen.findByTestId("plugin-card");
    expect(card.textContent).toContain("testing-mcp-server");

    // The tool count fills in once the stdio server finishes its
    // handshake; the stats row aggregates it.
    await waitFor(
      () => {
        expect(card.textContent).toMatch(/\d+ tools/);
      },
      { timeout: 20_000 },
    );
    await waitFor(() => {
      expect(screen.getByTestId("plugins-stats").textContent).toMatch(
        /1 plugin · \d+ tools enabled/,
      );
    });
  }, 40_000);

  it("shows cards with a placeholder count while discovery is pending", async () => {
    // A stdio process that never speaks MCP keeps tool discovery
    // pending until the listTools timeout (8s). The card and stats must
    // not wait for it. The process exits once a sentinel file appears,
    // so the test can release the in-flight listTools invoke after the
    // assertions instead of holding it into harness teardown; the 60s
    // self-exit is a backstop against a leak when an assertion fails.
    const sentinel = path.join(
      os.tmpdir(),
      `dyad-hanging-mcp-${process.pid}.sentinel`,
    );
    await ipc.mcp.createServer({
      name: "hanging-mcp-server",
      transport: "stdio",
      command: "node",
      args: [
        "-e",
        `const fs = require("fs");
         setInterval(() => {
           if (fs.existsSync(${JSON.stringify(sentinel)})) process.exit(0);
         }, 100);
         setTimeout(() => process.exit(1), 60_000);`,
      ],
      enabled: true,
    });
    try {
      harness.mountSurface({ route: "/plugins" });

      const card = await screen.findByTestId("plugin-card", undefined, {
        timeout: 5_000,
      });
      expect(card.textContent).toContain("hanging-mcp-server");
      expect(card.textContent).toContain("— tools");
      expect(screen.getByTestId("plugins-stats").textContent).toBe(
        "1 plugin · — tools enabled",
      );
    } finally {
      fs.writeFileSync(sentinel, "");
      try {
        await harness.bridge.settleInFlight(15_000);
      } finally {
        fs.rmSync(sentinel, { force: true });
      }
    }
  }, 40_000);

  it("shows a placeholder count when tool discovery fails", async () => {
    const { stop } = await harness.mcp.addHttpServer();
    harness.mountSurface({ route: "/plugins" });

    const card = await screen.findByTestId("plugin-card");
    await waitFor(
      () => {
        expect(card.textContent).toMatch(/\d+ tools/);
      },
      { timeout: 20_000 },
    );

    // Kill the server, then force a re-listing through the enabled
    // toggle (each update invalidates the tools query). The failed
    // listing must fall back to the placeholder, not report "0 tools".
    await stop();
    const enabledSwitch = within(card).getByRole("switch");
    await harness.setSwitch(enabledSwitch, false);
    await harness.setSwitch(enabledSwitch, true);
    await waitFor(
      () => {
        expect(card.textContent).toContain("— tools");
        expect(screen.getByTestId("plugins-stats").textContent).toBe(
          "1 plugin · — tools enabled",
        );
      },
      { timeout: 20_000 },
    );
    expect(card.textContent).not.toMatch(/\d+ tools/);
  }, 40_000);

  it("opens the detail page, changes a consent, and deletes the plugin", async () => {
    const server = await harness.mcp.addStdioServer();
    harness.mountSurface({ route: "/plugins" });

    fireEvent.click(
      await screen.findByRole("button", { name: "Open testing-mcp-server" }),
    );
    const detail = await screen.findByTestId("plugin-detail");
    await within(detail).findByText("calculator_add");

    // Change calculator_add's consent to "Always allow".
    const toolRow = within(detail)
      .getByText("calculator_add")
      .closest("div[class*='border']") as HTMLElement;
    await harness.selectFromBaseUiSelect(
      within(toolRow).getByRole("combobox"),
      "Always allow",
    );
    await waitFor(async () => {
      const consents = await ipc.mcp.getToolConsents();
      expect(consents).toContainEqual(
        expect.objectContaining({
          serverId: server.id,
          toolName: "calculator_add",
          consent: "always",
        }),
      );
    });

    // Denying a tool removes it from the enabled-tools count.
    await harness.selectFromBaseUiSelect(
      within(toolRow).getByRole("combobox"),
      "Deny",
    );
    await waitFor(async () => {
      const consents = await ipc.mcp.getToolConsents();
      expect(consents).toContainEqual(
        expect.objectContaining({
          serverId: server.id,
          toolName: "calculator_add",
          consent: "denied",
        }),
      );
    });
    const { tools } = await ipc.mcp.listTools(server.id);
    const total = tools.length;
    fireEvent.click(screen.getByRole("button", { name: "All Plugins" }));
    await waitFor(() => {
      expect(screen.getByTestId("plugins-stats").textContent).toBe(
        `1 plugin · ${total - 1} tools enabled`,
      );
    });
    expect((await screen.findByTestId("plugin-card")).textContent).toContain(
      `${total - 1} of ${total} tools enabled`,
    );

    // Back into the detail page to delete it.
    fireEvent.click(
      await screen.findByRole("button", { name: "Open testing-mcp-server" }),
    );
    const detailAgain = await screen.findByTestId("plugin-detail");

    // Delete asks for confirmation, then returns to the list.
    fireEvent.click(
      within(detailAgain).getByRole("button", { name: "Delete" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

    await screen.findByText("No plugins added yet.");
    const servers = await ipc.mcp.listServers();
    expect(servers).toHaveLength(0);
  }, 40_000);
});
