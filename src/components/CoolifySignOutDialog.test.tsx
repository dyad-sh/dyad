import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));

const h = vi.hoisted(() => ({ revealCredentials: vi.fn() }));
vi.mock("@/ipc/types", () => ({
  ipc: { coolifySetup: { revealCredentials: h.revealCredentials } },
}));

const { queryKeys } = await import("@/lib/queryKeys");
const { CoolifySignOutDialog: Dialog } = await import("./CoolifySignOutDialog");

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

const onConfirm = vi.fn();
const onOpenChange = vi.fn();

function Harness({ open }: { open: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <Dialog open={open} onOpenChange={onOpenChange} onConfirm={onConfirm} />
    </QueryClientProvider>
  );
}

function open(props: { open?: boolean } = {}) {
  return render(<Harness open={props.open ?? true} />);
}

async function openAndSettle() {
  const result = open();
  await waitFor(() =>
    expect(screen.getByTestId("coolify-sign-out-dialog")).toBeTruthy(),
  );
  return result;
}

function signOutButton() {
  return screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.revealCredentials.mockResolvedValue(FULL);
});

describe("acknowledging the loss", () => {
  it("will not sign out until the box is ticked", async () => {
    // The whole point of the dialog: the password below is about to go and
    // Dyad has the only copy, so confirming has to be a separate act.
    await openAndSettle();

    expect(signOutButton().disabled).toBe(true);
  });

  it("signs out once it is", async () => {
    const user = userEvent.setup();
    await openAndSettle();

    await user.click(screen.getByTestId("coolify-sign-out-acknowledge"));
    await user.click(signOutButton());

    expect(onConfirm).toHaveBeenCalled();
  });

  it("starts unticked again the next time it opens", async () => {
    // Otherwise a tick from an earlier sign-out arms this one, and the last
    // look at the password is skipped.
    const user = userEvent.setup();
    const { rerender } = await openAndSettle();
    await user.click(screen.getByTestId("coolify-sign-out-acknowledge"));
    await waitFor(() => expect(signOutButton().disabled).toBe(false));

    rerender(<Harness open={false} />);
    rerender(<Harness open />);

    await waitFor(() => expect(signOutButton().disabled).toBe(true));
  });
});

describe("nothing to look at yet", () => {
  it("will not sign out while it is still finding out", async () => {
    // Ticking a box that says the details above have been saved, over a panel
    // that has not shown any, is not the acknowledgement this asks for.
    h.revealCredentials.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    open();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-sign-out-dialog")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("coolify-sign-out-acknowledge"));

    expect(signOutButton().disabled).toBe(true);
  });

  it("says so when it cannot read what it has stored", async () => {
    // Signing out still forgets them, so staying silent would destroy
    // credentials the user was never shown.
    h.revealCredentials.mockRejectedValue(new Error("keychain locked"));
    open();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-sign-out-unreadable")).toBeTruthy(),
    );
    // Said once. The panel below reports the read; this only adds what it
    // means for signing out, so both saying it reads as a stutter.
    expect(
      screen.queryAllByText(/could not read what it has stored/i),
    ).toHaveLength(1);
    // And said after it. "Anyway" contrasts with a failure, so meeting it
    // first leaves the user contrasting with nothing.
    const cause = screen.getByText(/could not read what it has stored/i);
    const addendum = screen.getByTestId("coolify-sign-out-unreadable");
    expect(
      cause.compareDocumentPosition(addendum) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the details on screen when only a later read failed", async () => {
    // The panel still has them, so it still shows them. Saying a read failed
    // over a panel full of credentials leaves a sentence hanging off nothing,
    // and this is the moment the user is asked to confirm they saved them.
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Dialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("coolify-field-password")).toBeTruthy(),
    );

    h.revealCredentials.mockRejectedValue(new Error("keychain locked"));
    await client.refetchQueries({ queryKey: queryKeys.coolify.credentials });
    await waitFor(() => expect(h.revealCredentials).toHaveBeenCalledTimes(2));

    expect(screen.getByTestId("coolify-field-password")).toBeTruthy();
    expect(screen.queryByTestId("coolify-sign-out-unreadable")).toBeNull();
    // And the acknowledgement still means what it says.
    await user.click(screen.getByTestId("coolify-sign-out-acknowledge"));
    expect(signOutButton().disabled).toBe(false);
  });

  it("says when it holds a password it cannot read", async () => {
    // The panel cannot show a row for a value it does not have, so a missing
    // password would otherwise read as there never having been one.
    h.revealCredentials.mockResolvedValue({
      ...FULL,
      server: { ...FULL.server, password: null },
    });
    open();

    const addendum = await waitFor(() =>
      screen.getByTestId("coolify-sign-out-locked-password"),
    );
    // Said once. The panel below states what Dyad is holding; this only adds
    // what signing out does to it, so both saying it reads as a stutter.
    expect(screen.queryAllByText(/holding an admin password/i)).toHaveLength(1);
    // And said after it, for the same reason the read failure is.
    const cause = screen.getByTestId("coolify-credentials-locked-password");
    expect(
      cause.compareDocumentPosition(addendum) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the last look", () => {
  it("shows what is about to be forgotten", async () => {
    await openAndSettle();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-credentials")).toBeTruthy(),
    );
    expect(screen.getByTestId("coolify-field-address")).toBeTruthy();
    expect(screen.getByTestId("coolify-field-password")).toBeTruthy();
  });

  it("says the password cannot be got back when there is one", async () => {
    // Coolify can mint another token; it cannot tell anyone this password.
    await openAndSettle();

    await waitFor(() =>
      expect(
        screen.getByText(/only thing holding it/, { exact: false }),
      ).toBeTruthy(),
    );
  });

  it("does not say it for an instance Dyad did not set up", async () => {
    // Connected by pasting a token, so nothing here was invented by Dyad and
    // a warning about losing it forever would be untrue.
    h.revealCredentials.mockResolvedValue({ ...FULL, server: null });
    await openAndSettle();

    await waitFor(() => expect(h.revealCredentials).toHaveBeenCalled());
    expect(screen.queryByText(/only thing holding it/)).toBeNull();
  });

  it("asks for nothing while it is closed", async () => {
    open({ open: false });

    expect(h.revealCredentials).not.toHaveBeenCalled();
  });
});
