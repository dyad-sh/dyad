import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

/**
 * What the panel shows before it has an answer.
 *
 * There are three states without data and they are not the same thing: still
 * loading, paused because the renderer is offline, and failed. A paused query
 * is pending with no data and no error — react-query's default network mode
 * holds it until connectivity returns — so treating "no data" as failure put
 * a red error card in front of a read that had not been attempted.
 */

const deploy = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock("@/hooks/useCoolifyDeploy", () => ({
  useCoolifyDeploy: () => ({
    snapshot: { type: "idle" },
    status: undefined,
    isStatusLoading: false,
    statusError: null,
    refetchStatus: vi.fn(),
    discovery: undefined,
    discoveryError: null,
    isDiscovering: false,
    refetchDiscovery: vi.fn(),
    saveToken: { mutateAsync: vi.fn(), isPending: false },
    clearToken: { mutateAsync: vi.fn(), isPending: false },
    saveConnection: { mutateAsync: vi.fn(), isPending: false },
    disconnect: { mutateAsync: vi.fn(), isPending: false },
    createProject: { mutateAsync: vi.fn(), isPending: false },
    checkDomain: { mutateAsync: vi.fn(), isPending: false },
    deploy: { mutateAsync: vi.fn(), isPending: false },
    ...deploy.value,
  }),
}));

// Coolify deploys from GitHub, so a connected app always has a repository —
// without one the Deploy button is disabled for that reason instead.
vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({
    app: { name: "demo", githubOrg: "acme", githubRepo: "demo" },
    loading: false,
  }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: vi.fn() } },
}));

const { CoolifyConnector } = await import("./CoolifyConnector");

describe("before the status query has answered", () => {
  it("waits rather than claiming a failure when it is merely paused", () => {
    // Offline: pending, no data, no error. Nothing has gone wrong.
    deploy.value = { status: undefined, statusError: null };
    render(<CoolifyConnector appId={1} />);

    expect(screen.queryByTestId("coolify-status-error")).toBeNull();
    expect(screen.getByText(/Loading/)).toBeTruthy();
  });

  it("says what went wrong once the read actually fails", () => {
    // Blank with no message and no retry was the old behaviour, and the query
    // neither retries nor raises a toast, so nothing else would have said it.
    deploy.value = {
      status: undefined,
      statusError: new Error("settings unreadable"),
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByTestId("coolify-status-error")).toBeTruthy();
    expect(screen.getByText(/settings unreadable/)).toBeTruthy();
  });
});

describe("consent to an unencrypted address", () => {
  it("does not carry over to an address it was not given for", async () => {
    // Ticked for one plain-HTTP host, then the host is edited. The token would
    // otherwise be sent in the clear to a machine nobody agreed to.
    deploy.value = {
      status: {
        hasToken: false,
        tokenId: null,
        instanceUrl: null,
        connection: null,
        appUrl: null,
        lastDeployedAt: null,
      },
    };
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    const url = screen.getByTestId("coolify-instance-url");
    await user.type(url, "http://box.local:8000");
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox", { checked: true })).toBeTruthy();

    // Another plain-HTTP address, so the consent checkbox is still on screen
    // and the assertion is about the tick rather than about the box vanishing.
    await user.clear(url);
    await user.type(url, "http://other.local:8000");

    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { checked: true })).toBeNull();
  });

  it("does not survive the form being refilled from settings", async () => {
    // Typing is not the only thing that writes the address: an effect refills
    // it from settings, so switching apps puts the remembered one back. A tick
    // given for the typed address would then be sitting over a different one.
    deploy.value = {
      status: {
        hasToken: false,
        tokenId: null,
        instanceUrl: "http://remembered.local:8000",
        connection: null,
        appUrl: null,
        lastDeployedAt: null,
      },
    };
    const user = userEvent.setup();
    const { rerender } = render(<CoolifyConnector appId={1} />);

    const url = screen.getByTestId("coolify-instance-url");
    await user.clear(url);
    await user.type(url, "http://typed.local:8000");
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox", { checked: true })).toBeTruthy();

    rerender(<CoolifyConnector appId={2} />);

    expect((url as HTMLInputElement).value).toBe(
      "http://remembered.local:8000",
    );
    expect(screen.queryByRole("checkbox", { checked: true })).toBeNull();
  });
});

/**
 * What the pickers say before the lists arrive.
 *
 * Discovery goes to the user's own server, so the wait is real. An enabled
 * select over an empty dropdown reads as "this instance has nothing to offer",
 * which is a different claim from "the list has not arrived yet".
 */
describe("the server and project pickers while discovery is in flight", () => {
  function setupDiscovery(value: Record<string, unknown>) {
    deploy.value = {
      status: {
        hasToken: true,
        tokenId: "abc123",
        instanceUrl: "https://coolify.test",
        connection: null,
        appUrl: null,
        lastDeployedAt: null,
      },
      ...value,
    };
  }

  it("says the list is loading rather than showing an empty one", async () => {
    setupDiscovery({
      discovery: undefined,
      isDiscovering: true,
      isDiscoveryPending: true,
    });
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(screen.getByTestId("coolify-server-select"));

    expect(screen.getByText("Loading servers...")).toBeTruthy();
  });

  it("waits rather than saying the instance has no servers, when offline", async () => {
    // react-query pauses every query while the renderer is offline: pending,
    // no data, no error, and isFetching false. Read as an answer, that becomes
    // a claim about the user's own infrastructure that nothing checked.
    setupDiscovery({
      discovery: undefined,
      isDiscovering: false,
      isDiscoveryPending: true,
    });
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    expect(screen.queryByText(/has no servers Dyad can see/)).toBeNull();
    await user.click(screen.getByTestId("coolify-server-select"));
    expect(screen.getByText("Loading servers...")).toBeTruthy();
  });

  it("keeps showing a list it already has during a background refetch", async () => {
    // isDiscovering is isFetching, so it is true for refetches over a list the
    // user is already reading. Replacing that with a spinner would take the
    // options away mid-edit, which is worse than the gap being closed.
    setupDiscovery({
      discovery: {
        servers: [{ uuid: "srv-1", name: "production" }],
        projects: [],
      },
      isDiscovering: true,
      isDiscoveryPending: false,
    });
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(screen.getByTestId("coolify-server-select"));

    expect(screen.queryByText("Loading servers...")).toBeNull();
    expect(screen.getByText("production")).toBeTruthy();
  });
});

/**
 * What the connected view says about where an app deploys.
 *
 * The names come from discovery, which talks to the user's own server, so
 * there is often nothing to show. Filling the gap with the words "server" and
 * "project" reads as a configuration rather than as the absence of one.
 */
describe("naming the target in the connected view", () => {
  const CONNECTED = {
    hasToken: true,
    tokenId: "abc123",
    instanceUrl: "https://coolify.test",
    connection: {
      instanceUrl: "https://coolify.test",
      serverUuid: "srv-1",
      projectUuid: "prj-1",
      environmentName: "production",
      domain: null,
    },
    appUrl: "https://demo.example.com",
    lastDeployedAt: 1,
  };

  it("names the server and project once discovery has answered", () => {
    deploy.value = {
      status: CONNECTED,
      discovery: {
        servers: [{ uuid: "srv-1", name: "production-box" }],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByText("production-box / storefront")).toBeTruthy();
  });

  it("says the instance cannot be reached rather than inventing names", () => {
    deploy.value = {
      status: CONNECTED,
      discovery: undefined,
      discoveryError: new Error("getaddrinfo ENOTFOUND coolify.test"),
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByText(/Can't reach your Coolify/)).toBeTruthy();
    // The deployment itself is fine, so its address still shows and Deploy is
    // still offered — a name lookup failing is not the app being down.
    expect(screen.getByText("https://demo.example.com")).toBeTruthy();
    expect(
      (screen.getByTestId("coolify-deploy") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("says which part it cannot name when the server is not on this instance", () => {
    // Discovery answered, but the saved server is not in what came back — the
    // case the "belongs to a different Coolify" banner is for. The header names
    // the project it could resolve and marks the server unknown, so the two
    // agree rather than the header inventing a name the banner contradicts.
    deploy.value = {
      status: CONNECTED,
      discovery: {
        servers: [{ uuid: "srv-elsewhere", name: "other-box" }],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByText("Unknown server / storefront")).toBeTruthy();
    expect(screen.getByText(/belongs to a different Coolify/)).toBeTruthy();
  });

  it("keeps saying the app belongs elsewhere while the list refreshes", () => {
    // A refetch does not change the answer, and withdrawing it re-offered
    // Deploy every time the window regained focus.
    deploy.value = {
      status: CONNECTED,
      discovery: {
        servers: [{ uuid: "srv-elsewhere", name: "other-box" }],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
      isDiscovering: true,
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByText(/belongs to a different Coolify/)).toBeTruthy();
    expect(
      (screen.getByTestId("coolify-deploy") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("waits rather than inventing names while discovery is pending", () => {
    deploy.value = {
      status: CONNECTED,
      discovery: undefined,
      isDiscoveryPending: true,
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByText("Loading...")).toBeTruthy();
  });
});

/**
 * What the DNS warnings claim about the save that follows them.
 *
 * Every one of them ends "Saved anyway", so firing them before the save turns
 * a refused save into two contradictory toasts — one saying it was kept, one
 * saying it was not — with nothing to tell the user which is true.
 */
describe("warning about a domain while saving", () => {
  const CONNECTION = {
    instanceUrl: "https://coolify.test",
    serverUuid: "srv-1",
    projectUuid: "prj-1",
    environmentName: "production",
    domain: "app.example.com",
  };

  function setup(saveConnection: { mutateAsync: ReturnType<typeof vi.fn> }) {
    deploy.value = {
      status: {
        hasToken: true,
        instanceUrl: "https://coolify.test",
        connection: CONNECTION,
        appUrl: null,
        lastDeployedAt: null,
      },
      discovery: { servers: [], projects: [] },
      // The domain does not resolve to the server, which is the case the
      // warnings exist for.
      checkDomain: {
        mutateAsync: vi.fn(async () => ({
          verdict: "no-records",
          hostname: "app.example.com",
          expectedIp: "203.0.113.10",
          actualIps: [],
        })),
        isPending: false,
      },
      saveConnection: { ...saveConnection, isPending: false },
    };
  }

  beforeEach(() => {
    toastMock.warning.mockClear();
    toastMock.error.mockClear();
  });

  async function saveFrom(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByTestId("coolify-save-connection"));
  }

  it("stays silent about a domain on a connection that was not saved", async () => {
    const mutateAsync = vi.fn(async () => {
      throw new Error("This app is deploying.");
    });
    setup({ mutateAsync });
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await saveFrom(user);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalled();
    // The save was refused, so nothing may claim it was kept.
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("warns about the domain once the connection is saved", async () => {
    const mutateAsync = vi.fn(async () => ({}));
    setup({ mutateAsync });
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await saveFrom(user);

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalled());
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.warning.mock.calls[0][0]).toContain("no DNS record");
  });
});
