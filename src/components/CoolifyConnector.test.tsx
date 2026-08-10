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

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: { name: "demo" }, loading: false }),
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
    setupDiscovery({ discovery: undefined, isDiscovering: true });
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

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
    });
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(screen.getByTestId("coolify-server-select"));

    expect(screen.queryByText("Loading servers...")).toBeNull();
    expect(screen.getByText("production")).toBeTruthy();
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
