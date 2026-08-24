import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

// Stubbed so these tests stay about the connector. The real one fetches
// secrets through its own mutation, which would drag a query client into every
// case here for something none of them are checking.
vi.mock("@/components/CoolifyCredentials", () => ({
  CoolifyCredentials: ({ showTitle }: { showTitle?: boolean }) => (
    <div data-testid="coolify-credentials-stub">
      {showTitle ? "Your Coolify server" : null}
    </div>
  ),
}));

// Stubbed down to its two edges — that it is open, and the way to confirm —
// so these cases can check the wiring without the checkbox gating, which is
// the dialog's own test's job.
vi.mock("@/components/CoolifySignOutDialog", () => ({
  CoolifySignOutDialog: ({
    open,
    onConfirm,
  }: {
    open: boolean;
    onConfirm: () => void;
  }) =>
    open ? (
      <button data-testid="confirm-sign-out" onClick={onConfirm}>
        confirm
      </button>
    ) : null,
}));

// The real installer fetches a key and runs mutations of its own, none of
// which these cases are about.
vi.mock("@/components/CoolifyServerSetup", () => ({
  CoolifyServerSetup: ({
    children,
    onUseExisting,
  }: {
    children?: React.ReactNode;
    onUseExisting?: (url?: string) => void;
  }) => (
    <div data-testid="coolify-server-setup-stub">
      <button
        type="button"
        onClick={() => onUseExisting?.("https://installed.example.com")}
      >
        hand over
      </button>
      {children}
    </div>
  ),
}));

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
const loadedApp = vi.hoisted(() => ({
  value: { name: "demo", githubOrg: "acme", githubRepo: "demo" } as Record<
    string,
    unknown
  >,
}));
vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: loadedApp.value, loading: false }),
}));
const setup = vi.hoisted(() => ({ state: { type: "idle" } as unknown }));
vi.mock("@/ipc/types", () => ({
  ipc: {
    system: { openExternalUrl: vi.fn() },
    coolifySetup: { snapshot: () => Promise.resolve(setup.state) },
    events: { coolifySetup: { onChanged: () => () => {} } },
  },
}));

const { CoolifyConnector: Panel } = await import("./CoolifyConnector");

// The installer's state is the main process's, shared by every window — so
// each case has to say what it is, or it inherits the last one's.
beforeEach(() => {
  setup.state = { type: "idle" };
});

function CoolifyConnector(props: { appId: number | null }) {
  // One client for the life of the test, so a rerender keeps the cache it
  // built — a fresh one per render would throw away anything a test invalidated
  // or cached and quietly pass on the re-seed below.
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  // Seeded rather than fetched: what the main process is doing is present on
  // the first render in the app too, once any window has asked. Waiting for
  // it here would make an "it is not shown" assertion pass before the answer
  // arrived, which is no assertion at all.
  client.setQueryData(queryKeys.coolify.setup, setup.state);
  return (
    <QueryClientProvider client={client}>
      <Panel {...props} />
    </QueryClientProvider>
  );
}

describe("an install that is going on", () => {
  it("is shown even when this app's own status cannot be read", async () => {
    // The install belongs to the machine, not to the app being looked at. Put
    // behind that read, a multi-minute run is replaced by an error about
    // something else, with its Cancel button out of reach.
    deploy.value = {
      status: undefined,
      statusError: new Error("could not read the app"),
    };
    setup.state = {
      type: "running",
      host: "203.0.113.5",
      invocationRef: {
        kind: "coolify-setup",
        entityKey: "203.0.113.5",
        operationId: "op-1",
      },
      step: "installing",
      log: "",
      stopping: false,
    };
    render(<CoolifyConnector appId={1} />);

    await waitFor(() =>
      expect(screen.getByTestId("coolify-server-setup-stub")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coolify-status-error")).toBeNull();
  });
});

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
 * Two things share this panel and they are not the same thing.
 *
 * The Coolify instance is the user's and outlives any app; where an app
 * deploys is per app. Kept apart so the instance — and the way back into it —
 * is readable without opening one app's settings.
 */
describe("the instance and the app are separate sections", () => {
  function connected(connection: Record<string, unknown> | null) {
    deploy.value = {
      status: {
        hasToken: true,
        instanceUrl: "https://coolify.test",
        connection,
        appUrl: null,
        lastDeployedAt: null,
      },
      discovery: { servers: [], projects: [] },
    };
  }

  it("shows the instance section while picking where an app deploys", async () => {
    connected(null);
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByTestId("coolify-instance-section")).toBeTruthy();
    expect(screen.getByTestId("coolify-credentials-stub")).toBeTruthy();
    expect(screen.getByText("Where this app deploys")).toBeTruthy();
  });

  it("shows it once the app has somewhere to deploy too", async () => {
    // Previously it appeared only while editing, so the instance details were
    // reachable only by opening one app's settings.
    connected({
      instanceUrl: "https://coolify.test",
      serverUuid: "srv-1",
      projectUuid: "prj-1",
      environmentName: "production",
      domain: null,
    });
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByTestId("coolify-instance-section")).toBeTruthy();
    expect(screen.getByTestId("coolify-credentials-stub")).toBeTruthy();
  });

  it("offers signing out from the instance section, not the app one", async () => {
    connected(null);
    render(<CoolifyConnector appId={1} />);

    const section = screen.getByTestId("coolify-instance-section");
    expect(section.textContent).toContain("Sign out of Coolify");
  });

  /** The default mock builds a fresh one per render, so nothing can watch it. */
  function watchClearToken() {
    const mutateAsync = vi.fn();
    deploy.value.clearToken = { mutateAsync, isPending: false };
    return mutateAsync;
  }

  it("asks before forgetting anything", async () => {
    // Signing out throws away the password Dyad invented, and pressing the
    // button is not the same as having read that.
    connected(null);
    const clearToken = watchClearToken();
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(
      screen.getByRole("button", { name: "Sign out of Coolify" }),
    );

    expect(clearToken).not.toHaveBeenCalled();
    expect(screen.getByTestId("confirm-sign-out")).toBeTruthy();
  });

  it("forgets the instance once that is confirmed", async () => {
    connected(null);
    const clearToken = watchClearToken();
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(
      screen.getByRole("button", { name: "Sign out of Coolify" }),
    );
    await user.click(screen.getByTestId("confirm-sign-out"));

    expect(clearToken).toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalled();
  });
});

/** With no token, installing is the landing screen; this is the other route. */
async function openTokenForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "I already have Coolify installed" }),
  );
}

const NO_TOKEN = {
  status: {
    hasToken: false,
    tokenId: null,
    instanceUrl: null,
    serverUrl: null,
    connection: null,
    appUrl: null,
    lastDeployedAt: null,
  },
};

/** Installed, and its API token could not be minted — so no token, but a
    server whose account Dyad is the only holder of. */
const SERVER_NO_TOKEN = {
  status: { ...NO_TOKEN.status, serverUrl: "http://203.0.113.5:8000" },
};

describe("a server Dyad set up but has no token for", () => {
  it("will not set up another over the top of it", async () => {
    // Installing again replaces the only copy of this one's password, so it
    // is not something a screen offers on the way past.
    deploy.value = SERVER_NO_TOKEN;
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByTestId("coolify-already-has-server")).toBeTruthy();
    expect(screen.queryByTestId("coolify-server-setup-stub")).toBeNull();
  });

  it("offers signing out as the way to a different Coolify", async () => {
    // The only state where Dyad holds a Coolify and has no token to give up,
    // so without this there is nothing here that reaches the account.
    deploy.value = SERVER_NO_TOKEN;
    render(<CoolifyConnector appId={1} />);

    expect(
      screen.getByRole("button", { name: "Sign out of Coolify" }),
    ).toBeTruthy();
  });

  it("pins the address to that server", async () => {
    // A token typed against another address would leave the account naming
    // one machine and the token another.
    deploy.value = SERVER_NO_TOKEN;
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(
      screen.getByRole("button", { name: "Enter an API token" }),
    );
    const field = screen.getByTestId(
      "coolify-instance-url",
    ) as HTMLInputElement;
    expect(field.readOnly).toBe(true);
    await user.type(field, "https://somewhere-else.example.com");
    expect(field.value).toBe("http://203.0.113.5:8000");
  });

  it("still refuses a new install after one was cancelled", async () => {
    // Cancelling rests the machine in failed with nothing to report and no
    // way to clear it, so treating that as a failure to make room for would
    // hand the installer back for as long as the app is open.
    deploy.value = SERVER_NO_TOKEN;
    setup.state = {
      type: "failed",
      host: "203.0.113.5",
      message: "Cancelled",
      cancelled: true,
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByTestId("coolify-already-has-server")).toBeTruthy();
    expect(screen.queryByTestId("coolify-server-setup-stub")).toBeNull();
  });

  it("does not stand in front of an install that failed", async () => {
    // The account is written partway through, so a failure after that point
    // has one stored. The message, the log and the way to clear it are the
    // installer's, and retrying is the ordinary thing to do next.
    deploy.value = SERVER_NO_TOKEN;
    setup.state = {
      type: "failed",
      host: "203.0.113.5",
      message: "boom",
      cancelled: false,
    };
    render(<CoolifyConnector appId={1} />);
    expect({
      failureVisible: Boolean(
        screen.queryByTestId("coolify-server-setup-stub"),
      ),
      refusalCard: Boolean(screen.queryByTestId("coolify-already-has-server")),
    }).toEqual({ failureVisible: true, refusalCard: false });
  });

  it("can be connected to from the card that refuses a new install", async () => {
    // The address cannot be typed into here, so a form that never filled it
    // in would leave signing out — which forgets the password Dyad is the
    // only holder of — as the only way on from that card.
    deploy.value = SERVER_NO_TOKEN;
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(
      screen.getByRole("button", { name: "Enter an API token" }),
    );
    await user.type(screen.getByTestId("coolify-token"), "1|abc");
    // A freshly installed server answers on http until it has a certificate,
    // so this is the ordinary way through rather than an unusual one.
    await user.click(screen.getByTestId("coolify-acknowledge-insecure"));

    expect(
      (screen.getByTestId("coolify-save-token") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("keeps the way back to a failure the installer is reporting", async () => {
    // That screen carries the message, the output and the only control that
    // clears the run, so the token form must not be a one-way door into it.
    deploy.value = SERVER_NO_TOKEN;
    setup.state = {
      type: "failed",
      host: "203.0.113.5",
      message: "boom",
      cancelled: false,
    };
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(
      screen.getByRole("button", { name: "I already have Coolify installed" }),
    );
    expect(screen.getByTestId("coolify-no-instance")).toBeTruthy();
  });

  it("does not offer the installer as a way out of the token form", async () => {
    deploy.value = SERVER_NO_TOKEN;
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(
      screen.getByRole("button", { name: "Enter an API token" }),
    );
    expect(screen.queryByTestId("coolify-no-instance")).toBeNull();
  });
});

describe("where someone with no Coolify lands", () => {
  it("offers to install one rather than asking for a token", async () => {
    // The token form asks about a Coolify that already exists. Landing on it
    // tells everyone else they are in the wrong place.
    deploy.value = NO_TOKEN;
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByTestId("coolify-server-setup-stub")).toBeTruthy();
    expect(screen.queryByTestId("coolify-instance-url")).toBeNull();
  });

  it("reaches the token form from there, and back again", async () => {
    deploy.value = NO_TOKEN;
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await openTokenForm(user);
    expect(screen.getByTestId("coolify-instance-url")).toBeTruthy();

    await user.click(screen.getByTestId("coolify-no-instance"));
    expect(screen.getByTestId("coolify-server-setup-stub")).toBeTruthy();
  });

  it("puts the way out under what it knows, not against Install", async () => {
    deploy.value = NO_TOKEN;
    render(<CoolifyConnector appId={1} />);

    const text = screen.getByTestId("coolify-server-setup-stub").textContent;
    expect(text?.indexOf("Your Coolify server")).toBeLessThan(
      text?.indexOf("I already have Coolify installed") ?? -1,
    );
  });

  it("still shows what it knows about a server with no token yet", async () => {
    // Installing a server whose token could not be minted lands here, and the
    // account Dyad made is the only way into it.
    deploy.value = NO_TOKEN;
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByTestId("coolify-credentials-stub").textContent).toBe(
      "Your Coolify server",
    );
    await openTokenForm(user);
    expect(screen.getByTestId("coolify-credentials-stub")).toBeTruthy();
  });
});

describe("what the installer leaves on screen", () => {
  const DONE = {
    type: "done",
    host: "203.0.113.5",
    invocationRef: {
      kind: "coolify-setup",
      entityKey: "203.0.113.5",
      operationId: "op-1",
    },
    result: {
      dashboardUrl: "http://203.0.113.5:8000",
      secure: false,
      insecureReason: "No certificate arrived.",
      adminEmail: "me@gmail.com",
      adminPassword: "Abc123@xyz",
      tokenStored: true,
      tokenUnavailableReason: null,
      version: "4.3.2",
    },
  };

  const CONNECTED = {
    status: {
      hasToken: true,
      instanceUrl: "http://203.0.113.5:8000",
      connection: null,
      appUrl: null,
      lastDeployedAt: null,
    },
    discovery: { servers: [], projects: [] },
  };

  it("keeps a finished install up even once a token exists", async () => {
    // The install stores a token, so the panel would otherwise be replaced by
    // the connected view — taking with it the only notice that the server
    // ended up unencrypted.
    setup.state = DONE;
    deploy.value = CONNECTED;
    render(<CoolifyConnector appId={1} />);

    await waitFor(() =>
      expect(screen.getByTestId("coolify-server-setup-stub")).toBeTruthy(),
    );
  });

  it("moves on once the user has read it", async () => {
    // Dismissing is what ends it, and that is recorded where the install is:
    // in the main process, not in a flag this panel could lose.
    setup.state = { type: "idle" };
    deploy.value = CONNECTED;
    render(<CoolifyConnector appId={1} />);

    await waitFor(() =>
      expect(screen.getByText("Where this app deploys")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coolify-server-setup-stub")).toBeNull();
  });

  it("shows a running install rather than the form", async () => {
    setup.state = {
      type: "running",
      host: "203.0.113.5",
      invocationRef: {
        kind: "coolify-setup",
        entityKey: "203.0.113.5",
        operationId: "op-1",
      },
      step: "installing",
      log: "",
      stopping: false,
    };
    deploy.value = CONNECTED;
    render(<CoolifyConnector appId={1} />);

    await waitFor(() =>
      expect(screen.getByTestId("coolify-server-setup-stub")).toBeTruthy(),
    );
  });

  it("does not hold the panel open after a failure", async () => {
    // A failure leaves the form up with the installer's output under it, and
    // holding the view there made the token form unreachable.
    setup.state = {
      type: "failed",
      host: "203.0.113.5",
      invocationRef: {
        kind: "coolify-setup",
        entityKey: "203.0.113.5",
        operationId: "op-1",
      },
      message: "Installing Coolify failed (exit 1).",
      log: "dpkg: error",
      cancelled: false,
    };
    deploy.value = CONNECTED;
    render(<CoolifyConnector appId={1} />);

    // Waited for something positive: an absence is true before the answer
    // arrives, so asserting only that would pass without proving anything.
    await waitFor(() =>
      expect(screen.getByText("Where this app deploys")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coolify-server-setup-stub")).toBeNull();
  });

  it("is about the server, so it does not change with the app", async () => {
    // Deliberate: the install is about a machine, not about one app, and it
    // stays until the user has read it and moved on.
    setup.state = DONE;
    deploy.value = CONNECTED;
    const { rerender } = render(<CoolifyConnector appId={1} />);
    await waitFor(() =>
      expect(screen.getByTestId("coolify-server-setup-stub")).toBeTruthy(),
    );

    rerender(<CoolifyConnector appId={2} />);
    await waitFor(() =>
      expect(screen.getByTestId("coolify-server-setup-stub")).toBeTruthy(),
    );
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
    await openTokenForm(user);

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
    await openTokenForm(user);

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
    // Announced as an item of the list rather than as a bare text node, so a
    // screen reader hears that it is loading instead of an empty listbox.
    const option = screen.getByRole("option", { name: "Loading servers..." });
    expect(option.getAttribute("aria-disabled")).toBe("true");
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
 * An open edit form against a connection that changes underneath it.
 *
 * The status object is replaced whenever a save or a disconnect elsewhere
 * invalidates the query, and the effect that fills these fields keys on it.
 */
describe("editing while the saved connection changes", () => {
  const CONNECTION = {
    instanceUrl: "https://coolify.test",
    serverUuid: "srv-1",
    projectUuid: "prj-1",
    environmentName: "production",
    domain: "saved.example.com",
  };

  function statusWith(connection: Record<string, unknown>) {
    return {
      status: {
        hasToken: true,
        instanceUrl: "https://coolify.test",
        connection,
        appUrl: null,
        lastDeployedAt: null,
      },
      discovery: { servers: [], projects: [] },
    };
  }

  it("keeps what the user typed when the connection changes elsewhere", async () => {
    deploy.value = statusWith(CONNECTION);
    const user = userEvent.setup();
    const { rerender } = render(<CoolifyConnector appId={1} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const domain = screen.getByLabelText(
      "Domain (optional)",
    ) as HTMLInputElement;
    await user.clear(domain);
    await user.type(domain, "typed.example.com");

    // A save in another window: same app, a new object with a new domain.
    deploy.value = statusWith({ ...CONNECTION, domain: "elsewhere.test" });
    rerender(<CoolifyConnector appId={1} />);

    expect(
      (screen.getByLabelText("Domain (optional)") as HTMLInputElement).value,
    ).toBe("typed.example.com");
  });

  it("keeps Cancel with Save, since they answer the same form", async () => {
    // Up by the refresh control it read as cancelling something in progress.
    deploy.value = statusWith(CONNECTION);
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const save = screen.getByTestId("coolify-save-connection");
    const cancel = screen.getByRole("button", { name: "Cancel" });

    expect(save.parentElement).toBe(cancel.parentElement);
  });

  it("puts the saved values back when the edit is abandoned", async () => {
    // Cancel only drops the flag; refilling is the effect's job.
    deploy.value = statusWith(CONNECTION);
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const domain = screen.getByLabelText(
      "Domain (optional)",
    ) as HTMLInputElement;
    await user.clear(domain);
    await user.type(domain, "abandoned.example.com");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      (screen.getByLabelText("Domain (optional)") as HTMLInputElement).value,
    ).toBe("saved.example.com");
  });

  it("shows the app switched to, not the one being edited", async () => {
    // Switching apps closes the form, so the fields behind it have to be the
    // new app's — otherwise Edit would offer one app's target for another.
    deploy.value = statusWith(CONNECTION);
    const user = userEvent.setup();
    const { rerender } = render(<CoolifyConnector appId={1} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const domain = screen.getByLabelText(
      "Domain (optional)",
    ) as HTMLInputElement;
    await user.clear(domain);
    await user.type(domain, "typed.example.com");

    deploy.value = statusWith({ ...CONNECTION, domain: "other-app.test" });
    rerender(<CoolifyConnector appId={2} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      (screen.getByLabelText("Domain (optional)") as HTMLInputElement).value,
    ).toBe("other-app.test");
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

/**
 * Where the "this will not work over HTTP" warning is shown.
 *
 * It was rendered only by the connection form, so once a connection was saved
 * the view you deploy from said nothing — and the warning arrived in the log
 * after the build had already run.
 */
describe("the insecure-address warning in the connected view", () => {
  const CONNECTED_NO_DOMAIN = {
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
    appUrl: null,
    lastDeployedAt: null,
  };
  const DEFAULT_APP = { name: "demo", githubOrg: "acme", githubRepo: "demo" };

  afterEach(() => {
    loadedApp.value = { ...DEFAULT_APP };
  });

  it("warns before the deploy, not after it, for a Neon app with no domain", () => {
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = { status: CONNECTED_NO_DOMAIN };
    render(<CoolifyConnector appId={1} />);

    const warning = screen.getByTestId("coolify-insecure-auth-warning");
    expect(warning.textContent).toContain("will not work once deployed");
  });

  it("says nothing for an app with no database to break", () => {
    // The warning is about auth over an insecure origin, so an app with
    // neither provider has nothing to warn about and should stay quiet.
    loadedApp.value = { ...DEFAULT_APP };
    deploy.value = { status: CONNECTED_NO_DOMAIN };
    render(<CoolifyConnector appId={1} />);

    expect(screen.queryByTestId("coolify-insecure-auth-warning")).toBeNull();
  });

  it("stays quiet when the server's wildcard domain serves over TLS", () => {
    // Coolify builds the generated address from the wildcard, so an https one
    // means the app is reachable over TLS even with no domain of its own.
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      status: CONNECTED_NO_DOMAIN,
      discovery: {
        servers: [
          {
            uuid: "srv-1",
            name: "box",
            settings: { wildcard_domain: "https://apps.example.com" },
          },
        ],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.queryByTestId("coolify-insecure-auth-warning")).toBeNull();
  });

  it("warns when the server has no wildcard, which means an sslip address", () => {
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      status: CONNECTED_NO_DOMAIN,
      discovery: {
        servers: [{ uuid: "srv-1", name: "box", settings: {} }],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
    };
    render(<CoolifyConnector appId={1} />);

    const warning = screen.getByTestId("coolify-insecure-auth-warning");
    expect(warning.textContent).toContain("will not work once deployed");
  });

  it("says nothing for an app already on an https address", () => {
    // Where the app actually is settles it: the server reporting no wildcard
    // describes what it would generate, not where this app already sits.
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      status: { ...CONNECTED_NO_DOMAIN, appUrl: "https://live.example.com" },
      discovery: {
        servers: [{ uuid: "srv-1", name: "box", settings: {} }],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.queryByTestId("coolify-insecure-auth-warning")).toBeNull();
  });

  it("keeps warning when a wildcard is added after the app was deployed", () => {
    // Coolify fixed this app's address at creation, so a wildcard added later
    // does not move it — the app is still on the plain sslip address.
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      status: {
        ...CONNECTED_NO_DOMAIN,
        appUrl: "http://x.203.0.113.10.sslip.io",
      },
      discovery: {
        servers: [
          {
            uuid: "srv-1",
            name: "box",
            settings: { wildcard_domain: "https://apps.example.com" },
          },
        ],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
    };
    render(<CoolifyConnector appId={1} />);

    expect(
      screen.getByTestId("coolify-insecure-auth-warning").textContent,
    ).toContain("will not work once deployed");
  });

  it("answers for the server being picked, not the one being replaced", async () => {
    // Editing to a server with an https wildcard should clear the warning
    // before saving, since that is where the next deploy lands.
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      // Deployed to the plain server, so its address must not answer for the
      // one being picked — the app has never been there.
      status: {
        ...CONNECTED_NO_DOMAIN,
        appUrl: "http://x.203.0.113.10.sslip.io",
      },
      discovery: {
        servers: [
          { uuid: "srv-1", name: "plain-box", settings: {} },
          {
            uuid: "srv-2",
            name: "tls-box",
            settings: { wildcard_domain: "https://apps.example.com" },
          },
        ],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
    };
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    expect(screen.getByTestId("coolify-insecure-auth-warning")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByTestId("coolify-server-select"));
    await user.click(screen.getByRole("option", { name: "tls-box" }));

    expect(screen.queryByTestId("coolify-insecure-auth-warning")).toBeNull();
  });

  it("stops trusting the old address when only the project changes", async () => {
    // Coolify releases the application on a project change too, so the next
    // deploy builds a new one and generates a fresh address for it — the old
    // https address says nothing about where this app is going.
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      status: { ...CONNECTED_NO_DOMAIN, appUrl: "https://live.example.com" },
      discovery: {
        servers: [{ uuid: "srv-1", name: "box", settings: {} }],
        projects: [
          { uuid: "prj-1", name: "storefront" },
          { uuid: "prj-2", name: "elsewhere" },
        ],
      },
    };
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    expect(screen.queryByTestId("coolify-insecure-auth-warning")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByTestId("coolify-project-select"));
    await user.click(screen.getByRole("option", { name: "elsewhere" }));

    // The server has no wildcard, so the new application gets an sslip address.
    expect(
      screen.getByTestId("coolify-insecure-auth-warning").textContent,
    ).toContain("will not work once deployed");
  });

  it("says it cannot tell when a deploy returned no address", () => {
    // Both the panel and the deploy log otherwise report clean success for a
    // deploy that reached nothing.
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      status: { ...CONNECTED_NO_DOMAIN, appUrl: null, lastDeployedAt: 1 },
      discovery: {
        servers: [
          {
            uuid: "srv-1",
            name: "box",
            settings: { wildcard_domain: "https://apps.example.com" },
          },
        ],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
    };
    render(<CoolifyConnector appId={1} />);

    expect(
      screen.getByTestId("coolify-insecure-auth-warning").textContent,
    ).toContain("reported no address");
  });

  it("does not claim a deploy is broken when it only lacks an address", () => {
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      status: { ...CONNECTED_NO_DOMAIN, appUrl: null, lastDeployedAt: 1 },
      discovery: {
        servers: [{ uuid: "srv-1", name: "box", settings: {} }],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
    };
    render(<CoolifyConnector appId={1} />);

    const text = screen.getByTestId(
      "coolify-insecure-auth-warning",
    ).textContent;
    expect(text).toContain("reported no address");
    expect(text).not.toContain("will not work once deployed");
  });

  it("can answer again once the app is moving somewhere new", async () => {
    // A move recreates the application, so the destination's wildcard predicts
    // its address — the missing address of the old one says nothing about it.
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      status: { ...CONNECTED_NO_DOMAIN, appUrl: null, lastDeployedAt: 1 },
      discovery: {
        servers: [
          { uuid: "srv-1", name: "plain-box", settings: {} },
          {
            uuid: "srv-2",
            name: "tls-box",
            settings: { wildcard_domain: "https://apps.example.com" },
          },
        ],
        projects: [{ uuid: "prj-1", name: "storefront" }],
      },
    };
    const user = userEvent.setup();
    render(<CoolifyConnector appId={1} />);

    expect(
      screen.getByTestId("coolify-insecure-auth-warning").textContent,
    ).toContain("reported no address");

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByTestId("coolify-server-select"));
    await user.click(screen.getByRole("option", { name: "tls-box" }));

    expect(screen.queryByTestId("coolify-insecure-auth-warning")).toBeNull();
  });

  it("still warns in the connection form, which is where it started", () => {
    // Both views share one block now; nothing covered this side before, so a
    // refactor could have dropped it without a test noticing.
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      status: {
        hasToken: true,
        tokenId: "abc123",
        instanceUrl: "https://coolify.test",
        connection: null,
        appUrl: null,
        lastDeployedAt: null,
      },
    };
    render(<CoolifyConnector appId={1} />);

    const warning = screen.getByTestId("coolify-insecure-auth-warning");
    expect(warning.textContent).toContain("will not work once deployed");
  });

  it("says nothing once the saved domain is https", () => {
    loadedApp.value = { ...DEFAULT_APP, neonProjectId: "neon-1" };
    deploy.value = {
      status: {
        ...CONNECTED_NO_DOMAIN,
        connection: {
          ...CONNECTED_NO_DOMAIN.connection,
          domain: "https://app.example.com",
        },
      },
    };
    render(<CoolifyConnector appId={1} />);

    expect(screen.queryByTestId("coolify-insecure-auth-warning")).toBeNull();
  });
});
