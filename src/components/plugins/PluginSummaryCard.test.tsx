import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@/ipc/types";
import { pluginConnection } from "@/shared/mcp_connection_ref";
import { PluginSummaryCard } from "./PluginSummaryCard";

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 1,
    connection: pluginConnection(1),
    name: "Coolify",
    transport: "stdio",
    command: "npx",
    args: null,
    envJson: null,
    headersJson: null,
    url: null,
    enabled: true,
    oauthEnabled: false,
    oauthConnected: false,
    oauthUnreadable: false,
    oauthCallbackPort: null,
    oauthClientId: null,
    envUnreadable: false,
    headersUnreadable: false,
    catalogSlug: null,
    defaultScope: "all",
    defaultAppIds: [],
    appConfigCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function renderCard(server: McpServer) {
  return render(
    <PluginSummaryCard
      server={server}
      needsSetup={false}
      setupLocked={false}
      switchLocked={false}
      toolCount={null}
      enabledToolCount={null}
      discoveryFailed={false}
      feedback={null}
      isConnecting={false}
      connectDisabled={false}
      onConnect={vi.fn()}
      onToggleEnabled={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
}

describe("PluginSummaryCard app scope summary", () => {
  it("puts the default's scope and the configuration count on separate lines", () => {
    renderCard(makeServer({ defaultScope: "none", appConfigCount: 1 }));

    const scope = screen.getByText("Default: no apps");
    const count = screen.getByText("1 app-specific configuration");
    expect(scope).not.toBe(count);
    expect(scope.textContent).toBe("Default: no apps");
  });

  it("says no apps for a selected default with none chosen", () => {
    renderCard(makeServer({ defaultScope: "selected", defaultAppIds: [] }));

    expect(screen.getByText("Default: no apps")).toBeTruthy();
    expect(screen.queryByText("Default: some apps")).toBeNull();
  });

  it("shows nothing extra for a plugin available to every app", () => {
    renderCard(makeServer());

    expect(screen.queryByText(/Default:/)).toBeNull();
    expect(screen.queryByText(/app-specific/)).toBeNull();
  });
});
