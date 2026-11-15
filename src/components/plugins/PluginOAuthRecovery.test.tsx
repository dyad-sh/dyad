import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpServerSchema } from "@/ipc/types/mcp";
import { PluginDetailPage } from "./PluginDetailPage";
import { PluginSummaryCard } from "./PluginSummaryCard";

const mocks = vi.hoisted(() => ({ disconnect: vi.fn(), connect: vi.fn() }));
const server = McpServerSchema.parse({
  id: 1,
  name: "Locked plugin",
  transport: "http",
  command: null,
  args: null,
  envJson: null,
  headersJson: null,
  url: "https://example.com/mcp",
  enabled: true,
  oauthEnabled: true,
  oauthConnected: false,
  oauthUnreadable: true,
  oauthCallbackPort: null,
  oauthClientId: null,
  envUnreadable: false,
  headersUnreadable: false,
  catalogSlug: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/useMcp", () => ({
  useMcp: () => ({
    servers: [server],
    toolsByServer: {},
    statusByServer: {},
    errorByServer: {},
    consentsMap: {},
    isServersLoading: false,
  }),
}));
vi.mock("@/hooks/useMcpCatalog", () => ({
  useMcpCatalog: () => ({ data: { entries: [] }, isLoading: false }),
}));
vi.mock("./usePluginConnect", () => ({
  usePluginConnect: () => ({
    connectingServerId: null,
    disconnectingServerId: null,
    feedbackFor: () => null,
    onConnect: mocks.connect,
    onDisconnect: mocks.disconnect,
  }),
}));
vi.mock("./AddPluginDialog", () => ({ useOauthStorageEncrypted: () => true }));
vi.mock("./KeyValueEditor", () => ({ KeyValueEditor: () => null }));
vi.mock("@/components/DeleteConfirmationDialog", () => ({
  DeleteConfirmationDialog: () => null,
}));

describe("unreadable plugin OAuth recovery", () => {
  beforeEach(() => vi.clearAllMocks());
  it("offers explicit reset on the detail page before reconnecting", () => {
    render(<PluginDetailPage serverId={1} />);
    expect(screen.getByText(/Unlock or restore your OS keyring/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset OAuth" }));
    expect(mocks.disconnect).toHaveBeenCalledWith(1);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it("routes the summary recovery action to the detail page", () => {
    const onOpen = vi.fn();
    render(
      <PluginSummaryCard
        server={server}
        needsSetup={false}
        setupLocked={false}
        toolCount={null}
        enabledToolCount={null}
        discoveryFailed
        feedback={null}
        isConnecting={false}
        connectDisabled={false}
        onConnect={mocks.connect}
        onToggleEnabled={vi.fn()}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review connection" }));
    expect(onOpen).toHaveBeenCalledWith(1);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
