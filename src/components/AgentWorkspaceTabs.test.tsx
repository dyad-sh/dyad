import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The test environment has no localStorage, which atomWithStorage needs.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
});

const navigate = vi.fn();
const historyBack = vi.fn();
const historyForward = vi.fn();
let pathname = "/settings";
let historyIndex = 0;
let historyLength = 1;
let canGoBack = false;

// Partial mock: the tab bar's Desktop Mode toggle pulls in the app registry,
// whose route modules need the real Route class from this package.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  // The bar's back control reads history; the suite renders it without a
  // RouterProvider.
  useRouter: () => ({
    history: {
      canGoBack: () => canGoBack,
      back: historyBack,
      forward: historyForward,
      length: historyLength,
    },
  }),
  useRouterState: ({ select }: any) =>
    select({ location: { pathname, state: { __TSR_index: historyIndex } } }),
}));

const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query");
const { AgentWorkspaceTabs: RawAgentWorkspaceTabs } =
  await import("./AgentWorkspaceTabs");

// The bar now hosts the coder chat strip, which loads chats through react
// query — the same client it has in the running app.
function AgentWorkspaceTabs() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <RawAgentWorkspaceTabs />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  navigate.mockClear();
  historyBack.mockClear();
  historyForward.mockClear();
  localStorage.clear();
  pathname = "/settings";
  historyIndex = 0;
  historyLength = 1;
  canGoBack = false;
});

describe("navigation history", () => {
  it("always shows the user's current location", async () => {
    pathname = "/dashboard";
    render(<AgentWorkspaceTabs />);

    expect(
      (await screen.findByTestId("workspace-current-location")).textContent,
    ).toContain("Dashboard");
  });

  it("shows where the user came from and navigates back to it", async () => {
    const { rerender } = render(<AgentWorkspaceTabs />);
    await screen.findByTestId("workspace-current-location");

    pathname = "/coder/helix";
    historyIndex = 1;
    historyLength = 2;
    canGoBack = true;
    rerender(<AgentWorkspaceTabs />);

    expect(
      (await screen.findByTestId("workspace-previous-location")).textContent,
    ).toContain("Settings");
    expect(
      screen.getByTestId("workspace-current-location").textContent,
    ).toContain("Helix");

    await userEvent.click(screen.getByTestId("workspace-previous-location"));
    expect(historyBack).toHaveBeenCalledOnce();
  });

  it("supports forward navigation when a later history entry exists", async () => {
    historyLength = 2;
    render(<AgentWorkspaceTabs />);

    const forward = await screen.findByTestId("workspace-go-forward");
    expect((forward as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(forward);
    expect(historyForward).toHaveBeenCalledOnce();
  });
});

describe("screen tabs", () => {
  it("opens a tab for the screen being viewed", async () => {
    render(<AgentWorkspaceTabs />);
    const settingsTab = await screen.findByTestId("screen-tab-/settings");
    expect(settingsTab).toBeTruthy();
    expect(settingsTab.textContent).toContain("Settings");
  });

  it("keeps earlier screens open when navigating on", async () => {
    const { rerender } = render(<AgentWorkspaceTabs />);
    await screen.findByTestId("screen-tab-/settings");

    // Navigating to Helix must not replace the Settings tab: that is the whole
    // point of not losing a screen to open another.
    pathname = "/coder/helix";
    rerender(<AgentWorkspaceTabs />);

    expect(await screen.findByTestId("screen-tab-/coder/helix")).toBeTruthy();
    expect(screen.getByTestId("screen-tab-/settings")).toBeTruthy();
  });

  it("gives Helix its own tab rather than folding it into Coding Agents", async () => {
    pathname = "/coder/helix";
    render(<AgentWorkspaceTabs />);
    const helixTab = await screen.findByTestId("screen-tab-/coder/helix");
    expect(helixTab.textContent).toContain("Helix");
  });

  it("does not open a screen tab for a chat route", () => {
    pathname = "/chat-agent";
    render(<AgentWorkspaceTabs />);
    expect(screen.queryByTestId("screen-tab-/chat-agent")).toBeNull();
  });

  it("closes a tab and moves to its neighbour", async () => {
    const { rerender } = render(<AgentWorkspaceTabs />);
    await screen.findByTestId("screen-tab-/settings");
    pathname = "/coder/helix";
    rerender(<AgentWorkspaceTabs />);
    await screen.findByTestId("screen-tab-/coder/helix");

    await userEvent.click(screen.getByTestId("screen-close-tab-/coder/helix"));

    expect(navigate).toHaveBeenCalledWith({ to: "/settings" });
    expect(screen.queryByTestId("screen-tab-/coder/helix")).toBeNull();
  });

  it("closes the Hermes Dashboard tab and leaves the workspace", async () => {
    // It was the one tab in the bar with no close button.
    pathname = "/agent-os";
    const { rerender } = render(<AgentWorkspaceTabs />);
    await screen.findByTestId("hermes-dashboard-tab");

    await userEvent.click(screen.getByTestId("hermes-close-dashboard-tab"));

    expect(navigate).toHaveBeenCalledWith({ to: "/agents" });

    // navigate is mocked, so move the route the way the real one would.
    pathname = "/agents";
    rerender(<AgentWorkspaceTabs />);
    expect(screen.queryByTestId("hermes-dashboard-tab")).toBeNull();

    // Opening Agent OS again brings its tab back: a screen you are looking at
    // always has a tab.
    pathname = "/agent-os";
    rerender(<AgentWorkspaceTabs />);
    await screen.findByTestId("hermes-dashboard-tab");
  });

  it("goes to the dashboard when the last screen tab closes", async () => {
    // Closing the screen you are looking at has to land somewhere, and the
    // dashboard is the app's home surface.
    render(<AgentWorkspaceTabs />);
    await screen.findByTestId("screen-tab-/settings");

    await userEvent.click(screen.getByTestId("screen-close-tab-/settings"));

    expect(navigate).toHaveBeenCalledWith({ to: "/dashboard" });
  });

  it("does not navigate when closing a tab that is not being viewed", async () => {
    const { rerender } = render(<AgentWorkspaceTabs />);
    await screen.findByTestId("screen-tab-/settings");
    pathname = "/coder/helix";
    rerender(<AgentWorkspaceTabs />);
    await screen.findByTestId("screen-tab-/coder/helix");

    await userEvent.click(screen.getByTestId("screen-close-tab-/settings"));

    expect(navigate).not.toHaveBeenCalled();
  });

  it("links each tab to its route", async () => {
    render(<AgentWorkspaceTabs />);
    const link = await screen.findByTestId("screen-tab-/settings");
    expect(link.getAttribute("href")).toBe("/settings");
  });

  it("carries the coder chat tabs, so there is only one tab row", async () => {
    // These used to render in the title bar, stacking a second strip above
    // this one.
    render(<AgentWorkspaceTabs />);
    expect(await screen.findByTestId("coder-chat-tabs")).toBeTruthy();
  });

  it("shows the bar on a coder route even with nothing else open", async () => {
    pathname = "/coder/studio";
    render(<AgentWorkspaceTabs />);
    expect(await screen.findByTestId("agent-workspace-tabs")).toBeTruthy();
  });
});
