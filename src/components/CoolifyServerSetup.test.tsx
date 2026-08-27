import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { SETUP_MACHINE_REPORTED } from "@/ipc/types/coolify_setup";

const toastMock = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/toast", () => ({ showError: h.showError }));

const h = vi.hoisted(() => ({
  showError: vi.fn(),
  getServerKey: vi.fn(),
  snapshot: vi.fn(),
  dismiss: vi.fn(),
  acceptInsecureToken: vi.fn(),
  changedListeners: [] as Array<(state: unknown) => void>,
  inspect: vi.fn(),
  run: vi.fn(),
  cancel: vi.fn(),
}));

/** What the main process says is going on, pushed as it would be in the app. */
const IDLE = { type: "idle" } as const;
function push(state: unknown) {
  h.changedListeners.forEach((fn) => fn(state));
}
const runningState = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

vi.mock("@/ipc/types", () => ({
  ipc: {
    coolifySetup: {
      getServerKey: h.getServerKey,
      inspect: h.inspect,
      run: h.run,
      cancel: h.cancel,
      snapshot: h.snapshot,
      dismiss: h.dismiss,
      acceptInsecureToken: h.acceptInsecureToken,
    },
    events: {
      coolifySetup: {
        onChanged: (listener: (state: unknown) => void) => {
          h.changedListeners.push(listener);
          return () => {};
        },
      },
    },
  },
}));

const { CoolifyServerSetup } = await import("./CoolifyServerSetup");

function renderPanel(onUseExisting = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  return {
    invalidate,
    ...render(
      <QueryClientProvider client={client}>
        <CoolifyServerSetup onUseExisting={onUseExisting}>
          <div data-testid="beneath" />
        </CoolifyServerSetup>
      </QueryClientProvider>,
    ),
  };
}

const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA dyad-server-access";

beforeEach(() => {
  vi.clearAllMocks();
  h.changedListeners.length = 0;
  h.snapshot.mockResolvedValue(IDLE);
  h.dismiss.mockResolvedValue(undefined);
  h.acceptInsecureToken.mockResolvedValue(undefined);
  h.getServerKey.mockResolvedValue({ publicKey: PUBLIC_KEY });
  h.cancel.mockResolvedValue(undefined);
  h.inspect.mockResolvedValue({
    ready: true,
    reason: null,
    alreadyInstalled: false,
    memoryMb: 1967,
    hostFingerprint: "SHA256:3FQS9D0B0DVizoYtw1hNV09EClubwWqRUXoFnRTu6nA",
  });
});

/** Install is offered only for a server Dyad has looked at. */
async function checkServer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("coolify-setup-inspect"));
  await waitFor(() =>
    expect(screen.getByTestId("coolify-setup-inspection")).toBeTruthy(),
  );
}

describe("the key the user has to install", () => {
  it("shows it first, because nothing else can happen until it is added", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-public-key").textContent).toBe(
        PUBLIC_KEY,
      ),
    );
  });
});

describe("the admin address", () => {
  it("warns about a domain Coolify will refuse, while it is being typed", async () => {
    // Coolify resolves the domain when it seeds the account, so an address on
    // a reserved domain fails after a multi-minute install rather than before.
    const user = userEvent.setup();
    renderPanel();
    await user.type(
      screen.getByTestId("coolify-setup-email"),
      "admin@dyad.test",
    );

    expect(screen.getByText(/admin@example.test are rejected/)).toBeTruthy();
  });

  it("says nothing about an ordinary address", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");

    expect(screen.queryByText(/are rejected/)).toBeNull();
  });

  it("will not start an install it knows the address fails", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(
      screen.getByTestId("coolify-setup-email"),
      "admin@dyad.test",
    );
    // Checked, so what refuses below is the address rather than the check the
    // button is otherwise waiting for.
    await checkServer(user);

    expect(
      screen.getByTestId("coolify-setup-install").hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("checking the server first", () => {
  it("shows the fingerprint, so it can be compared before anything is sent", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.click(screen.getByTestId("coolify-setup-inspect"));

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-inspection")).toBeTruthy(),
    );
    expect(screen.getByText(/SHA256:3FQS9D0B/)).toBeTruthy();
  });

  it("blocks the install when the server cannot take one", async () => {
    h.inspect.mockResolvedValue({
      ready: false,
      reason: "This server already has Coolify on it.",
      alreadyInstalled: true,
      memoryMb: 1967,
      hostFingerprint: null,
    });
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    await user.click(screen.getByTestId("coolify-setup-inspect"));

    await waitFor(() =>
      expect(screen.getByText(/already has Coolify/)).toBeTruthy(),
    );
    expect(
      screen.getByTestId("coolify-setup-install").hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("while it runs", () => {
  // The panel is a view of what the main process says is going on. It keeps
  // none of this itself, so leaving the screen and coming back finds it again.

  it("says which step it is on rather than only spinning", async () => {
    // The install takes minutes; a spinner with no label is indistinguishable
    // from a hang, and this is the screen people stare at.
    h.snapshot.mockResolvedValue(runningState({ step: "installing" }));
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("Installing Coolify")).toBeTruthy(),
    );
  });

  it("shows the installer's own output", async () => {
    h.snapshot.mockResolvedValue(
      runningState({ log: "3/6 Pulling Docker images..." }),
    );
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-log").textContent).toContain(
        "3/6 Pulling Docker images...",
      ),
    );
  });

  it("offers a way to stop", async () => {
    h.snapshot.mockResolvedValue(runningState());
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-cancel")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("coolify-setup-cancel"));
    expect(h.cancel).toHaveBeenCalled();
  });

  it("says it is stopping once asked, rather than offering again", async () => {
    h.snapshot.mockResolvedValue(runningState({ stopping: true }));
    renderPanel();

    await waitFor(() =>
      expect(
        (screen.getByTestId("coolify-setup-cancel") as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
  });

  it("shows a run this window did not start", async () => {
    // The whole point of holding this in the main process: the install was
    // started by another window, or by this one before it was replaced.
    h.snapshot.mockResolvedValue(runningState({ step: "securing" }));
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-running")).toBeTruthy(),
    );
    expect(screen.getByText("Setting up HTTPS")).toBeTruthy();
  });

  it("keeps up as the run moves on", async () => {
    renderPanel();
    await waitFor(() =>
      expect(screen.getByTestId("coolify-server-setup")).toBeTruthy(),
    );

    push(runningState({ step: "waiting-for-dashboard" }));

    await waitFor(() =>
      expect(screen.getByText("Waiting for Coolify to start")).toBeTruthy(),
    );
  });
});

describe("what it refuses before starting", () => {
  it("says so while a domain is being typed, not minutes later", async () => {
    // The same shape the installer refuses. Left to the guard, it arrives
    // after the install as the reason HTTPS did not happen.
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    await user.type(
      screen.getByTestId("coolify-setup-domain"),
      "coolify.example.com:8000",
    );

    expect(
      (screen.getByTestId("coolify-setup-install") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("will not install onto a server it has not looked at", async () => {
    // The check is what puts the fingerprint in front of the user. Installing
    // without it means trusting whatever answers the address with the admin
    // password and a token, and never showing them what they trusted.
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");

    expect(
      (screen.getByTestId("coolify-setup-install") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await checkServer(user);

    expect(
      (screen.getByTestId("coolify-setup-install") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("accepts an ordinary domain", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    await user.type(
      screen.getByTestId("coolify-setup-domain"),
      "coolify.example.com",
    );
    await checkServer(user);

    expect(
      (screen.getByTestId("coolify-setup-install") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});

describe("a re-check that does not finish", () => {
  it("leaves no verdict behind, and no install to press", async () => {
    // The main process keeps the last finished check's pass on purpose, so
    // this is the only thing between a check that never came back and an
    // install that sends the admin password to whatever answered.
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    await checkServer(user);
    expect(
      (screen.getByTestId("coolify-setup-install") as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    h.inspect.mockRejectedValueOnce(new Error("connection reset"));
    await user.click(screen.getByTestId("coolify-setup-inspect"));

    await waitFor(() =>
      expect(screen.queryByTestId("coolify-setup-inspection")).toBeNull(),
    );
    expect(
      (screen.getByTestId("coolify-setup-install") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("an answer about a server the user has moved on from", () => {
  it("does not show one machine's check against another's address", async () => {
    // The answer arrives after a round trip. By then the address in the field
    // may be a different machine, whose Install button this verdict would
    // otherwise disable.
    let answer!: (checks: unknown) => void;
    h.inspect.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPanel();
    const host = screen.getByTestId("coolify-setup-host");
    await user.type(host, "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    await user.click(screen.getByTestId("coolify-setup-inspect"));

    await user.clear(host);
    await user.type(host, "198.51.100.9");
    answer({
      ready: false,
      reason: "This server already has Coolify on it.",
      alreadyInstalled: true,
      memoryMb: 1967,
      hostFingerprint: "SHA256:aaa",
    });

    await waitFor(() => expect(h.inspect).toHaveBeenCalled());
    // The verdict belonged to the address it was asked about. Shown here it
    // would say this machine already has Coolify on it, which nobody checked.
    expect(screen.queryByTestId("coolify-setup-inspection")).toBeNull();
  });
});

describe("catching up with a run this window did not start", () => {
  it("is listening before it asks what is going on", async () => {
    // The answer takes a round trip. A run that finishes inside it is only
    // heard about if the listener was already there when the question left.
    let listenersWhenAsked = -1;
    h.snapshot.mockImplementation(async () => {
      listenersWhenAsked = h.changedListeners.length;
      return IDLE;
    });
    renderPanel();

    await waitFor(() => expect(h.snapshot).toHaveBeenCalled());
    expect(listenersWhenAsked).toBeGreaterThan(0);
  });

  it("does not let a late answer undo what it was told meanwhile", async () => {
    // The read says "installing" because that was true when it was asked. By
    // the time it lands the run is over, and letting it win would put the
    // panel back on a step the run has left, under a Cancel button for
    // something that is no longer going.
    let answer: (state: unknown) => void = () => {};
    h.snapshot.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderPanel();

    await waitFor(() => expect(h.changedListeners.length).toBeGreaterThan(0));
    push({
      type: "done",
      host: "203.0.113.5",
      invocationRef: {
        kind: "coolify-setup",
        entityKey: "203.0.113.5",
        operationId: "op-1",
      },
      result: {
        dashboardUrl: "https://203.0.113.5.sslip.io",
        secure: true,
        insecureReason: null,
        adminEmail: "me@gmail.com",
        adminPassword: "Abc123@xyz",
        tokenStored: true,
        tokenUnavailableReason: null,
        version: "4.3.2",
      },
    });
    answer(runningState());

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-done")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coolify-setup-running")).toBeNull();
  });
});

describe("when the panel cannot tell what is going on", () => {
  it("says so, and asking again clears it", async () => {
    // Install is disabled while this is unknown, and a disabled control with
    // no explanation reads as broken.
    h.snapshot.mockRejectedValue(new Error("no answer"));
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-snapshot-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("coolify-setup-install")).toHaveProperty(
      "disabled",
      true,
    );

    // The way out has to work, not just be on screen.
    h.snapshot.mockResolvedValue({ type: "idle" });
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(screen.queryByTestId("coolify-setup-snapshot-error")).toBeNull(),
    );
  });
});

describe("a failure with nothing to show for it", () => {
  it("can still be dismissed", async () => {
    // Connection and preflight refusals never reach the installer, so they
    // carry no output. Dismiss has to sit outside the log, or these failures
    // would have no way to clear them.
    h.snapshot.mockResolvedValue({
      type: "failed",
      host: "203.0.113.5",
      invocationRef: {
        kind: "coolify-setup",
        entityKey: "203.0.113.5",
        operationId: "op-1",
      },
      message: "Could not reach the server (ECONNREFUSED).",
      log: "",
      cancelled: false,
    });
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-failed-message")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coolify-setup-failed-log")).toBeNull();

    await user.click(screen.getByTestId("coolify-setup-dismiss-failure"));
    expect(h.dismiss).toHaveBeenCalled();
  });
});

describe("a failure that will not go away", () => {
  it("can be dismissed, since it follows the user everywhere", async () => {
    // The state is the main process's, so the last failure shows in every
    // app's panel and every window until something clears it.
    h.snapshot.mockResolvedValue({
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
    });
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-dismiss-failure")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("coolify-setup-dismiss-failure"));
    expect(h.dismiss).toHaveBeenCalled();
  });
});

describe("pressing Install", () => {
  it("does not offer a second press while the first is in flight", async () => {
    // The panel still shows the form until the broadcast lands, and a second
    // request is refused as a second setup.
    h.run.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    await checkServer(user);
    await user.click(screen.getByTestId("coolify-setup-install"));
    // The press has to have landed, or what is disabled below is the button
    // waiting for a check rather than the run it started.
    expect(h.run).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(
        (screen.getByTestId("coolify-setup-install") as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
  });

  it("does not start when the key could not be read", async () => {
    // The key is what the server trusts; without it the install cannot work,
    // and the panel already says so.
    h.getServerKey.mockRejectedValue(new Error("key file is corrupt"));
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    // Checked, so what is disabled below is the missing key rather than the
    // check the button is otherwise waiting for.
    await checkServer(user);

    await waitFor(() =>
      expect(
        (screen.getByTestId("coolify-setup-install") as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
  });
});

describe("the key the server needs", () => {
  it("offers a way to try again when it cannot be read", async () => {
    // Left as "Generating…" forever, there is nothing to read and nothing to
    // press, and the whole screen depends on it.
    h.getServerKey.mockRejectedValue(new Error("key file is corrupt"));
    renderPanel();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy(),
    );
  });
});

describe("the way out of the installer", () => {
  it("carries what the screen below adds, under the form", async () => {
    // The way out for someone who already has Coolify lives there.
    renderPanel();
    expect(screen.getByTestId("beneath")).toBeTruthy();
  });

  it("drops it once the install is running", async () => {
    // That screen has one thing left to say, and a link away from it is not
    // it. Nothing here is a next step while the work is going on.
    h.snapshot.mockResolvedValue(runningState());
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-running")).toBeTruthy(),
    );
    expect(screen.queryByTestId("beneath")).toBeNull();
  });

  it("asks for the admin email before the optional domain", async () => {
    // A required field under an optional one reads as optional too.
    renderPanel();
    const text = screen.getByTestId("coolify-server-setup").textContent ?? "";
    expect(text.indexOf("Email for the Coolify admin account")).toBeLessThan(
      text.indexOf("Domain (optional)"),
    );
  });
});

describe("when the user stops it", () => {
  it("does not report cancelling as a failure", async () => {
    // Cancelling is the user asking for the work to stop. The installer's
    // output under "What the server reported" reads as a fault.
    h.snapshot.mockResolvedValue({
      type: "failed",
      host: "203.0.113.5",
      invocationRef: {
        kind: "coolify-setup",
        entityKey: "203.0.113.5",
        operationId: "op-1",
      },
      message: "Cancelled.",
      log: "3/6 Pulling...",
      cancelled: true,
    });
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-server-setup")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coolify-setup-failed-log")).toBeNull();
  });

  it("does not raise a red error for a cancel", async () => {
    // The flow rethrows the cancellation, so it arrives here as a rejection —
    // and reporting it says something went wrong while the screen says
    // nothing did.
    h.run.mockRejectedValue(
      Object.assign(new DyadError("Cancelled.", DyadErrorKind.UserCancelled), {
        code: SETUP_MACHINE_REPORTED,
      }),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    await checkServer(user);
    await user.click(screen.getByTestId("coolify-setup-install"));

    await waitFor(() => expect(h.run).toHaveBeenCalled());
    expect(h.showError).not.toHaveBeenCalled();
  });

  it("says what the machine never saw, rather than swallowing it", async () => {
    // The IPC layer turns down bad input before the handler is reached, so
    // that error carries no mark and the machine has no state for it. Left
    // unsaid, pressing Install would do nothing at all.
    h.run.mockRejectedValue(
      new DyadError(
        "[coolify-setup:run] Invalid input",
        DyadErrorKind.Validation,
      ),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    await checkServer(user);
    await user.click(screen.getByTestId("coolify-setup-install"));

    await waitFor(() => expect(h.showError).toHaveBeenCalled());
  });

  it("still reports a refusal to start", async () => {
    // The shape the handler actually refuses with: nothing reached the
    // machine, so the error carries no mark and the panel says it out loud.
    h.run.mockRejectedValue(
      new DyadError(
        "A server is already being set up.",
        DyadErrorKind.Precondition,
      ),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    await checkServer(user);
    await user.click(screen.getByTestId("coolify-setup-install"));

    await waitFor(() => expect(h.showError).toHaveBeenCalled());
  });

  it("leaves a failed install to the panel rather than saying it twice", async () => {
    // The failure block carries the installer's own output; a toast beside it
    // repeats the same event with less to show.
    h.run.mockRejectedValue(
      Object.assign(
        new DyadError(
          "Installing Coolify failed (exit 1).",
          DyadErrorKind.External,
        ),
        { code: SETUP_MACHINE_REPORTED },
      ),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByTestId("coolify-setup-host"), "203.0.113.5");
    await user.type(screen.getByTestId("coolify-setup-email"), "me@gmail.com");
    await checkServer(user);
    await user.click(screen.getByTestId("coolify-setup-install"));

    await waitFor(() => expect(h.run).toHaveBeenCalled());
    expect(h.showError).not.toHaveBeenCalled();
  });

  it("still shows what the server said about a real failure", async () => {
    h.snapshot.mockResolvedValue({
      type: "failed",
      host: "203.0.113.5",
      invocationRef: {
        kind: "coolify-setup",
        entityKey: "203.0.113.5",
        operationId: "op-1",
      },
      message: "Installing Coolify failed (exit 1).",
      log: "dpkg: error processing",
      cancelled: false,
    });
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-failed-log")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("coolify-setup-failed-log").textContent,
    ).toContain("dpkg: error processing");
    // And what went wrong, which the installer's output does not always say.
    expect(
      screen.getByTestId("coolify-setup-failed-message").textContent,
    ).toContain("Installing Coolify failed");
  });
});

describe("when it finishes", () => {
  const DONE_RESULT = {
    dashboardUrl: "https://203.0.113.5.sslip.io",
    secure: true,
    insecureReason: null,
    adminEmail: "me@gmail.com",
    adminPassword: "Abc123@xyz",
    tokenStored: true,
    tokenUnavailableReason: null,
    version: "4.3.2",
  };

  const doneState = (over: Record<string, unknown> = {}) => ({
    type: "done" as const,
    host: "203.0.113.5",
    invocationRef: {
      kind: "coolify-setup",
      entityKey: "203.0.113.5",
      operationId: "op-1",
    },
    result: { ...DONE_RESULT, ...over },
  });

  it("does not keep a token for an unencrypted address unless asked to", async () => {
    // The token is held rather than written when the run ends, so continuing
    // past the warning without a word leaves it unkept.
    h.snapshot.mockResolvedValue(
      doneState({ secure: false, insecureReason: "No certificate arrived." }),
    );
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-continue")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("coolify-setup-continue"));

    expect(h.acceptInsecureToken).not.toHaveBeenCalled();
  });

  it("stays put when the token could not be kept", async () => {
    // Dismissing here would put the screen away having agreed to something
    // that was never stored, and say nothing about why.
    h.snapshot.mockResolvedValue(
      doneState({ secure: false, insecureReason: "No certificate arrived." }),
    );
    h.acceptInsecureToken.mockRejectedValue(new Error("keychain locked"));
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-accept-insecure")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("coolify-setup-accept-insecure"));
    await user.click(screen.getByTestId("coolify-setup-continue"));

    expect(h.showError).toHaveBeenCalled();
    expect(h.dismiss).not.toHaveBeenCalled();
  });

  it("says how to make a token by hand when the offered one is not kept", async () => {
    // Leaving the box unticked drops the token, and this is the only place
    // that says how to make one instead.
    h.snapshot.mockResolvedValue(
      doneState({ secure: false, insecureReason: "No certificate arrived." }),
    );
    renderPanel();

    const panel = await waitFor(() =>
      screen.getByTestId("coolify-setup-manual-token"),
    );
    expect(panel.textContent).toContain("Security → API Tokens");
    // A token Dyad made and will drop is not one it could not make. Saying
    // the latter here would contradict the offer to keep it, directly above.
    expect(panel.textContent).toContain("Unless you tick the box above");
    expect(panel.textContent).not.toContain("could not create");
    // Minting the token turned the API on, so this is not still to do.
    expect(panel.textContent).not.toContain("enable the API");
    expect(screen.getByTestId("coolify-setup-done").textContent).toContain(
      "It is not kept unless you say so",
    );
  });

  it("keeps it when the address is agreed to", async () => {
    h.snapshot.mockResolvedValue(
      doneState({ secure: false, insecureReason: "No certificate arrived." }),
    );
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-accept-insecure")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("coolify-setup-accept-insecure"));
    await user.click(screen.getByTestId("coolify-setup-continue"));

    expect(h.acceptInsecureToken).toHaveBeenCalled();
  });

  it("asks nothing when the address is encrypted", async () => {
    // Nothing crosses the network in the clear, so there is no decision.
    h.snapshot.mockResolvedValue(doneState());
    const user = userEvent.setup();
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-continue")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coolify-setup-accept-insecure")).toBeNull();
    await user.click(screen.getByTestId("coolify-setup-continue"));

    expect(h.acceptInsecureToken).not.toHaveBeenCalled();
  });

  it("shows the details, since this is the moment they are needed", async () => {
    h.snapshot.mockResolvedValue(doneState({ tokenStored: false }));
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-done")).toBeTruthy(),
    );
    expect(screen.getByTestId("coolify-setup-password").textContent).toBe(
      "Abc123@xyz",
    );
  });

  it("says nothing about encryption when the server got a certificate", async () => {
    // Dyad asks for one and usually gets it, so a standing warning would be
    // noise — and noise is what makes a real warning easy to miss.
    h.snapshot.mockResolvedValue(doneState({ tokenStored: false }));
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-done")).toBeTruthy(),
    );
    expect(screen.queryByTestId("coolify-setup-insecure")).toBeNull();
  });

  it("warns when it had to settle for plain HTTP", async () => {
    h.snapshot.mockResolvedValue(
      doneState({ secure: false, insecureReason: "No certificate arrived." }),
    );
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-insecure")).toBeTruthy(),
    );
  });

  it("says what is left to do when only the token step failed", async () => {
    h.snapshot.mockResolvedValue(
      doneState({ tokenStored: false, tokenUnavailableReason: "too old" }),
    );
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-manual-token")).toBeTruthy(),
    );
    expect(
      screen.getByTestId("coolify-setup-manual-token").textContent,
    ).toContain("too old");
  });

  it("puts the screen away and refreshes when the user moves on", async () => {
    // The address and token are already stored, but every window is still
    // holding the answer from before they were.
    h.snapshot.mockResolvedValue(doneState());
    const onUseExisting = vi.fn();
    const user = userEvent.setup();
    const { invalidate } = renderPanel(onUseExisting);

    await waitFor(() =>
      expect(screen.getByTestId("coolify-setup-continue")).toBeTruthy(),
    );
    await user.click(screen.getByTestId("coolify-setup-continue"));

    await waitFor(() => expect(h.dismiss).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.coolify.all,
    });
    // Refreshed before the screen is put away: the other order hands the
    // panel back to a connector that still believes there is no token, and
    // the empty install form flashes up.
    expect(invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      h.dismiss.mock.invocationCallOrder[0],
    );
    expect(onUseExisting).toHaveBeenCalledWith("https://203.0.113.5.sslip.io");
    // And before the screen is cleared: dismissing first puts the machine
    // back to idle while the panel above still believes there is nothing to
    // enter, so the empty install form appears in between.
    expect(onUseExisting.mock.invocationCallOrder[0]).toBeLessThan(
      h.dismiss.mock.invocationCallOrder[0],
    );
  });
});
