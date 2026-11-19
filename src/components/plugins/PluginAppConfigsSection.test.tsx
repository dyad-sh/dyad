import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAppConfig, McpServer } from "@/ipc/types";
import {
  nextConfigurationName,
  PluginAppConfigsSection,
} from "./PluginAppConfigsSection";
import { pluginConnection } from "@/shared/mcp_connection_ref";
import { PluginDefaultAvailability } from "./PluginDefaultAvailability";

const mocks = vi.hoisted(() => ({
  createAppConfig: vi.fn(),
  setAppConfigApps: vi.fn(),
  setPluginAvailability: vi.fn(),
  updateConnection: vi.fn(),
  deleteAppConfig: vi.fn(),
  isSaving: false,
}));

vi.mock("@/hooks/useMcp", () => ({
  useMcp: () => ({
    createAppConfig: mocks.createAppConfig,
    setAppConfigApps: mocks.setAppConfigApps,
    setPluginAvailability: mocks.setPluginAvailability,
    updateConnection: mocks.updateConnection,
    deleteAppConfig: mocks.deleteAppConfig,
    isSavingAppScope: mocks.isSaving,
  }),
}));
// The configuration's own settings and tools are covered elsewhere.
vi.mock("./PluginConnectionPanel", () => ({
  PluginConnectionPanel: () => null,
  PluginOAuthBadge: () => null,
  PluginOAuthButtons: () => null,
}));
vi.mock("@/components/DeleteConfirmationDialog", () => ({
  DeleteConfirmationDialog: ({
    details,
    onDelete,
    trigger,
  }: {
    details?: string;
    onDelete: () => Promise<void>;
    trigger?: ReactNode;
  }) => (
    <div>
      <div data-testid="delete-trigger">{trigger}</div>
      <div data-testid="delete-details">{details}</div>
      <button onClick={() => void onDelete()}>Confirm delete</button>
    </div>
  ),
}));

const APPS = [
  { id: 1, name: "Shop" },
  { id: 2, name: "Blog" },
  { id: 3, name: "Docs" },
];

function plugin(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 4,
    connection: pluginConnection(overrides.id ?? 4),
    name: "Coolify",
    transport: "http",
    command: null,
    args: null,
    envJson: null,
    headersJson: null,
    url: "https://prod.example.com/mcp",
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

function config(id: number, name: string, appIds: number[]): McpAppConfig {
  const { defaultScope, defaultAppIds, appConfigCount, ...rest } = plugin();
  void defaultScope;
  void defaultAppIds;
  void appConfigCount;
  return {
    ...rest,
    id,
    connection: { serverId: 4, appConfigId: id },
    serverId: 4,
    name,
    appIds,
  };
}

function renderSection(server: McpServer, appConfigs: McpAppConfig[]) {
  return render(
    <PluginAppConfigsSection
      server={server}
      appConfigs={appConfigs}
      apps={APPS}
      catalogEntry={undefined}
      catalogIsLoading={false}
    />,
  );
}

describe("PluginAppConfigsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSaving = false;
    mocks.createAppConfig.mockImplementation(async (params) => ({
      ...config(9, params.name, params.appIds),
    }));
    mocks.setAppConfigApps.mockResolvedValue(config(1, "Lab", []));
  });

  it("lists which apps use each configuration", () => {
    renderSection(plugin(), [config(1, "Lab", [2, 1]), config(2, "Old", [])]);

    expect(screen.getByText("Used by: Shop, Blog")).toBeTruthy();
    expect(screen.getByText("Not used by any app")).toBeTruthy();
  });

  it("says before saving that an app will move from its current configuration", async () => {
    renderSection(plugin(), [config(1, "Lab", [1])]);

    fireEvent.click(screen.getByRole("button", { name: /Add configuration/ }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Staging" },
    });
    expect(screen.getByText("currently: Lab")).toBeTruthy();
    // Screen readers hear the note with the checkbox.
    expect(
      screen.getByRole("checkbox", {
        name: "Shop",
        description: "currently: Lab",
      }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("checkbox", { name: "Shop" }));

    expect(
      screen.getByTestId("plugin-app-config-move-warning").textContent,
    ).toBe("Shop will move from Lab.");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(mocks.createAppConfig).toHaveBeenCalledWith({
        serverId: 4,
        name: "Staging",
        appIds: [1],
      }),
    );
  });

  it("explains where an app removed from a configuration goes", async () => {
    renderSection(plugin({ defaultScope: "selected", defaultAppIds: [1] }), [
      config(1, "Lab", [1, 2]),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Shop" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Blog" }));

    expect(
      within(screen.getByRole("dialog")).getByText(
        "Shop will use the default configuration. Blog won't have Coolify.",
      ),
    ).toBeTruthy();
  });

  it("edits a configuration under its own plugin", async () => {
    renderSection(plugin(), [config(1, "Lab", [1])]);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Lab server" },
    });
    await userEvent.click(screen.getByRole("checkbox", { name: "Blog" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.setAppConfigApps).toHaveBeenCalledWith({
        serverId: 4,
        appConfigId: 1,
        appIds: [1, 2],
      }),
    );
    expect(mocks.updateConnection).toHaveBeenCalledWith(
      { serverId: 4, appConfigId: 1 },
      { name: "Lab server" },
    );
  });

  it("deletes a configuration under its own plugin", async () => {
    renderSection(plugin(), [config(1, "Lab", [])]);

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await waitFor(() =>
      expect(mocks.deleteAppConfig).toHaveBeenCalledWith({
        serverId: 4,
        appConfigId: 1,
      }),
    );
  });

  it("warns before creating that the apps wait for setup, only when setup is required", () => {
    const { unmount } = render(
      <PluginAppConfigsSection
        server={plugin({ catalogSlug: "coolify" })}
        appConfigs={[]}
        apps={APPS}
        catalogEntry={{
          slug: "coolify",
          name: "Coolify",
          transport: "http",
          url: "https://prod.example.com/mcp",
          inputs: [{ kind: "header", name: "Authorization", label: "Token" }],
        }}
        catalogIsLoading={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add configuration/ }));
    expect(
      screen.getByText(/won't have Coolify until you finish setting it up/),
    ).toBeTruthy();
    unmount();

    renderSection(plugin(), []);
    fireEvent.click(screen.getByRole("button", { name: /Add configuration/ }));
    expect(screen.queryByText(/until you finish setting it up/)).toBeNull();
  });

  it("keeps the dialog open while a save is in flight", async () => {
    mocks.isSaving = true;
    renderSection(plugin(), []);

    fireEvent.click(screen.getByRole("button", { name: /Add configuration/ }));
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" })
        .disabled,
    ).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows the delete as pending until it finishes", async () => {
    let finish!: () => void;
    mocks.deleteAppConfig.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    renderSection(plugin(), [config(1, "Lab", [])]);

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    // On the card's own button, which stays visible once the dialog closes.
    const trigger = screen.getByTestId("delete-trigger");
    await waitFor(() => expect(trigger.textContent).toBe("Deleting…"));

    finish();
    await waitFor(() => expect(trigger.textContent).toBe("Delete"));
  });

  it("waits for configurations to load before saying there are none", () => {
    render(
      <PluginAppConfigsSection
        server={plugin()}
        appConfigs={[]}
        apps={APPS}
        catalogEntry={undefined}
        catalogIsLoading={false}
        isLoading
      />,
    );
    expect(screen.queryByText(/No app-specific configurations/)).toBeNull();
  });

  it("says the configurations couldn't load instead of saying there are none", () => {
    render(
      <PluginAppConfigsSection
        server={plugin()}
        appConfigs={[]}
        apps={APPS}
        catalogEntry={undefined}
        catalogIsLoading={false}
        loadFailed
      />,
    );
    expect(
      screen.getByText(
        /Couldn't load this plugin's app-specific configurations/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No app-specific configurations/)).toBeNull();
  });

  it("offers no collapse toggle for a configuration held open for setup", () => {
    render(
      <PluginAppConfigsSection
        server={plugin({ catalogSlug: "coolify" })}
        appConfigs={[
          { ...config(1, "Lab", [1]), catalogSlug: "coolify" },
          {
            ...config(2, "Ready", [2]),
            catalogSlug: "coolify",
            headersJson: { Authorization: "set" },
          },
        ]}
        apps={APPS}
        catalogEntry={{
          slug: "coolify",
          name: "Coolify",
          transport: "http",
          url: "https://prod.example.com/mcp",
          inputs: [{ kind: "header", name: "Authorization", label: "Token" }],
        }}
        catalogIsLoading={false}
      />,
    );
    const toggles = screen.queryAllByRole("button", { expanded: false });
    // Only the configuration that's set up can be expanded.
    expect(toggles).toHaveLength(1);
    expect(toggles[0].textContent).toContain("Ready");
    expect(screen.queryByRole("button", { expanded: true })).toBeNull();
  });

  it("says on delete which apps lose the plugin when there is no default", () => {
    renderSection(plugin({ defaultScope: "none" }), [config(1, "Lab", [3])]);

    expect(screen.getByTestId("delete-details").textContent).toBe(
      "Docs won't have Coolify (the default is set to No apps).",
    );
  });
});

describe("nextConfigurationName", () => {
  it("suggests a name no configuration uses, even after a delete", () => {
    expect(nextConfigurationName([])).toBe("Configuration 2");
    // "Configuration 2" was deleted, leaving 3; a count would suggest 3.
    expect(nextConfigurationName([{ name: "Configuration 3" }])).toBe(
      "Configuration 2",
    );
    expect(
      nextConfigurationName([
        { name: "Configuration 2" },
        { name: "Configuration 3" },
      ]),
    ).toBe("Configuration 4");
  });
});

describe("PluginDefaultAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setPluginAvailability.mockResolvedValue(plugin());
  });

  it("saves the apps a limited default serves, noting apps with their own configuration", async () => {
    render(
      <PluginDefaultAvailability
        server={plugin({ defaultScope: "selected", defaultAppIds: [1] })}
        appConfigs={[config(1, "Lab", [3])]}
        apps={APPS}
      />,
    );

    expect(screen.getByText("uses Lab")).toBeTruthy();
    // Nothing to save until the list changes.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Blog" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.setPluginAvailability).toHaveBeenCalledWith({
        serverId: 4,
        defaultScope: "selected",
        defaultAppIds: [1, 2],
      }),
    );
  });

  it("explains a default that serves no app", () => {
    render(
      <PluginDefaultAvailability
        server={plugin({ defaultScope: "none" })}
        appConfigs={[]}
        apps={APPS}
      />,
    );

    expect(
      screen.getByText(
        "Not used: apps without their own configuration won't have Coolify.",
      ),
    ).toBeTruthy();
  });
});
