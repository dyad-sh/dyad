import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));

const h = vi.hoisted(() => ({ revealCredentials: vi.fn() }));
vi.mock("@/ipc/types", () => ({
  ipc: { coolifySetup: { revealCredentials: h.revealCredentials } },
}));

const { queryKeys } = await import("@/lib/queryKeys");
const { CoolifyCredentials: Panel } = await import("./CoolifyCredentials");

function CoolifyCredentials(props: { showTitle?: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <Panel {...props} />
    </QueryClientProvider>
  );
}

const FULL = {
  instance: {
    url: "https://203.0.113.5.sslip.io",
    apiToken: "1|abcdefghijklmnop",
  },
  server: {
    url: "https://203.0.113.5.sslip.io",
    email: "me@gmail.com",
    password: "Abc123@xyzAbc123@xyz",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.revealCredentials.mockResolvedValue(FULL);
});

/**
 * Waits for the read to have answered, not merely to have been asked.
 *
 * This panel renders nothing while the question is in flight and nothing
 * when the answer is empty, so asserting on the first of those proves only
 * that a promise had not resolved yet — it holds just as well with the guard
 * for the second one taken out.
 */
async function settle() {
  await waitFor(() => expect(h.revealCredentials).toHaveBeenCalled());
  // A turn of the event loop, not just the microtask queue: react-query
  // carries a resolved read through to a render on a macrotask, so flushing
  // microtasks alone lands back here with the panel still pending — which
  // looks exactly like the empty answer these assertions are about.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderAndSettle() {
  render(<CoolifyCredentials />);
  await waitFor(() =>
    expect(screen.getByTestId("coolify-credentials")).toBeTruthy(),
  );
}

describe("what is on screen without asking", () => {
  it("shows the details rather than hiding them behind a control", async () => {
    // Made to click to discover Dyad even has these, most people never find
    // out — and then signing out locks them out of their own server.
    await renderAndSettle();

    expect(screen.getByTestId("coolify-field-address").textContent).toBe(
      FULL.instance.url,
    );
    expect(screen.getByTestId("coolify-field-email").textContent).toBe(
      FULL.server.email,
    );
  });

  it("includes the API token, not only the sign-in details", async () => {
    // Signing out of Coolify in Dyad clears it, so without this the token is
    // gone for good and the instance has to be set up again.
    await renderAndSettle();
    expect(screen.getByTestId("coolify-field-api-token")).toBeTruthy();
  });

  it("keeps the secrets masked until they are asked for", async () => {
    // Showing the details is not the same as showing the secrets: these sit
    // in a panel someone may have open while screen sharing.
    await renderAndSettle();

    expect(screen.getByTestId("coolify-field-password").textContent).toMatch(
      /^•+$/,
    );
    expect(screen.getByTestId("coolify-field-api-token").textContent).toMatch(
      /^•+$/,
    );
  });

  it("does not mask what is not secret", async () => {
    await renderAndSettle();
    expect(screen.queryByRole("button", { name: "Show Address" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show Email" })).toBeNull();
  });
});

describe("revealing one value", () => {
  it("shows the password when asked, and hides it again", async () => {
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(screen.getByRole("button", { name: "Show Password" }));
    expect(screen.getByTestId("coolify-field-password").textContent).toBe(
      FULL.server.password,
    );

    await user.click(screen.getByRole("button", { name: "Hide Password" }));
    expect(screen.getByTestId("coolify-field-password").textContent).toMatch(
      /^•+$/,
    );
  });

  it("reveals each value on its own", async () => {
    // Showing the password should not put the token on screen too.
    const user = userEvent.setup();
    await renderAndSettle();

    await user.click(screen.getByRole("button", { name: "Show Password" }));

    expect(screen.getByTestId("coolify-field-api-token").textContent).toMatch(
      /^•+$/,
    );
  });
});

describe("naming the section", () => {
  it("names a server Dyad installed but has no token for", async () => {
    // Reached by installing a server whose API token could not be minted, so
    // the account is all Dyad has for it.
    h.revealCredentials.mockResolvedValue({ ...FULL, instance: null });
    render(<CoolifyCredentials showTitle />);

    await waitFor(() =>
      expect(screen.getByText("Your Coolify server")).toBeTruthy(),
    );
  });

  it("leaves no heading over nothing", async () => {
    // The caller cannot know there is anything to show until this has asked.
    h.revealCredentials.mockResolvedValue({ instance: null, server: null });
    render(<CoolifyCredentials showTitle />);

    await settle();
    expect(screen.queryByText("Your Coolify server")).toBeNull();
  });
});

describe("a password Dyad holds but cannot read", () => {
  it("says so rather than showing a server that never had one", async () => {
    // readSettings drops a password it cannot decrypt and keeps the account.
    // Left as a missing row, that reads as there never having been one — and
    // the obvious next move from there is the sign-out that discards it.
    h.revealCredentials.mockResolvedValue({
      instance: null,
      server: {
        url: "http://203.0.113.5:8000",
        email: "me@gmail.com",
        password: null,
      },
    });
    render(<CoolifyCredentials />);

    await settle();
    expect(
      screen.getByTestId("coolify-credentials-locked-password").textContent,
    ).toContain("cannot read it on this machine");
    expect(screen.queryByTestId("coolify-field-server-password")).toBeNull();
  });

  it("says it on the merged panel too", async () => {
    // One address for both, so the fields are merged — the same gap, on the
    // layout the connected view uses.
    h.revealCredentials.mockResolvedValue({
      instance: { url: "http://203.0.113.5:8000", apiToken: "1|abc" },
      server: {
        url: "http://203.0.113.5:8000",
        email: "me@gmail.com",
        password: null,
      },
    });
    render(<CoolifyCredentials />);

    await settle();
    expect(
      screen.getByTestId("coolify-credentials-locked-password"),
    ).toBeTruthy();
    expect(screen.queryByTestId("coolify-field-password")).toBeNull();
  });
});

describe("two servers that are not the same server", () => {
  it("keeps each address with what it opens", async () => {
    // Installed a server whose token could not be minted, then connected to a
    // different Coolify. One address over both would read as a way into the
    // connected one that is not one.
    h.revealCredentials.mockResolvedValue({
      instance: {
        url: "https://someone-elses.example.com",
        apiToken: "1|other",
      },
      server: {
        url: "http://203.0.113.5:8000",
        email: "me@gmail.com",
        password: "Abc123@xyz",
      },
    });
    await renderAndSettle();

    // One id each, so a lookup for the address reaches one thing rather than
    // two — both blocks carry one.
    expect(screen.getByTestId("coolify-field-server-address")).toBeTruthy();
    expect(screen.getByTestId("coolify-field-instance-address")).toBeTruthy();

    const forServer = screen.getByTestId("coolify-credentials-server");
    const forInstance = screen.getByTestId("coolify-credentials-instance");
    expect(forServer.textContent).toContain("http://203.0.113.5:8000");
    expect(forServer.textContent).not.toContain("someone-elses");
    expect(forInstance.textContent).toContain("someone-elses.example.com");
    // The password belongs to the machine Dyad built, and stays with it.
    expect(forInstance.textContent).not.toContain("Abc123@xyz");
  });

  it("shows one block when both describe the same address", async () => {
    await renderAndSettle();

    expect(screen.queryByTestId("coolify-credentials-server")).toBeNull();
    expect(screen.queryByTestId("coolify-credentials-instance")).toBeNull();
    expect(screen.getAllByTestId(/^coolify-field-address$/)).toHaveLength(1);
  });
});

describe("a read that did not answer", () => {
  it("keeps details it already has when a later read fails", async () => {
    // The panel refetches on window focus once its data is a minute old, and
    // production does not retry. Standing that failure in front of a password
    // Dyad holds the only copy of takes it off screen with nothing to copy —
    // and in the sign-out dialog it goes just as the user is asked to confirm
    // they have saved it.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Panel />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("coolify-field-password")).toBeTruthy(),
    );

    h.revealCredentials.mockRejectedValue(new Error("keychain locked"));
    await client.refetchQueries({ queryKey: queryKeys.coolify.credentials });
    // The refetch settling is not the panel having re-rendered on it, and
    // reading the screen in between shows what was there before either way.
    await waitFor(() => expect(h.revealCredentials).toHaveBeenCalledTimes(2));

    expect(screen.getByTestId("coolify-field-password")).toBeTruthy();
    expect(screen.queryByTestId("coolify-credentials-unreadable")).toBeNull();
  });

  it("says so rather than rendering nothing", async () => {
    // Callers introduce this panel as the details they are about to show, so
    // a blank space where they should be reads as Dyad holding nothing.
    h.revealCredentials.mockRejectedValue(new Error("keychain locked"));
    render(<CoolifyCredentials />);

    await waitFor(() =>
      expect(screen.getByTestId("coolify-credentials-unreadable")).toBeTruthy(),
    );
  });

  it("stays silent when there is genuinely nothing stored", async () => {
    // Signed out, or connected by pasting a token. Saying a read failed here
    // would report a problem that did not happen.
    h.revealCredentials.mockResolvedValue({ instance: null, server: null });
    const { container } = render(<CoolifyCredentials />);

    // Waiting for the call is not waiting for the answer, and a pending query
    // renders nothing whatever this branch does. Settling first is what makes
    // a wrong branch here visible.
    await waitFor(() => expect(h.revealCredentials).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("coolify-credentials-unreadable")).toBeNull();
    expect(container.textContent).toBe("");
  });
});

describe("an instance Dyad did not set up", () => {
  it("renders nothing rather than an empty heading", async () => {
    // Connected by pasting a token: no account Dyad created, no address it
    // chose. A panel of blanks would read as something having failed.
    h.revealCredentials.mockResolvedValue({ instance: null, server: null });
    const { container } = render(<CoolifyCredentials />);

    await settle();
    expect(screen.queryByTestId("coolify-credentials")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("still shows a token the user pasted themselves", async () => {
    h.revealCredentials.mockResolvedValue({
      instance: { url: "https://coolify.example.com", apiToken: "1|theirs" },
      server: null,
    });
    await renderAndSettle();

    expect(screen.getByTestId("coolify-field-api-token")).toBeTruthy();
    expect(screen.queryByTestId("coolify-field-password")).toBeNull();
  });
});
