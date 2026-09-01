import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Provider, createStore, useSetAtom } from "jotai";
import { useEffect } from "react";
import { HelpDialog } from "./HelpDialog";
import { helpDialogAtom } from "@/atoms/helpDialogAtom";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { PROSE_BUDGET } from "@/lib/issueBody";

const mocks = vi.hoisted(() => ({
  getSystemDebugInfo: vi.fn(),
  getSessionDebugBundle: vi.fn(),
  uploadToSignedUrl: vi.fn(),
  openExternalUrl: vi.fn(),
  takeScreenshot: vi.fn(),
  recopyScreenshot: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    system: {
      getSystemDebugInfo: mocks.getSystemDebugInfo,
      openExternalUrl: mocks.openExternalUrl,
      uploadToSignedUrl: mocks.uploadToSignedUrl,
      takeScreenshot: mocks.takeScreenshot,
      recopyScreenshot: mocks.recopyScreenshot,
    },
    misc: { getSessionDebugBundle: mocks.getSessionDebugBundle },
  },
}));

// Stable across renders, matching the real client, so effects keyed on it do
// not re-run.
const posthogClient = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => posthogClient,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: null }),
}));

vi.mock("@/hooks/useUserBudgetInfo", () => ({
  useUserBudgetInfo: () => ({ userBudget: { redactedUserId: "user-abc" } }),
}));

// Both are react-query backed and only feed the "Selected Model"/"Effort Level"
// diagnostic lines, which these tests do not assert on.
vi.mock("@/hooks/useChatMode", () => ({
  useChatMode: () => ({ chat: null }),
}));

vi.mock("@/hooks/useLanguageModelsByProviders", () => ({
  useLanguageModelsByProviders: () => ({ data: undefined }),
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showInfo: mocks.showInfo,
}));

vi.mock("./HelpBotDialog", () => ({ HelpBotDialog: () => null }));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) =>
    open ? (
      <div>
        {/* Stands in for Esc, the overlay, and the built-in close button. */}
        <button onClick={() => onOpenChange?.(false)}>
          mock-dialog-dismiss
        </button>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
}));

const debugInfo = {
  nodeVersion: "20.0.0",
  pnpmVersion: "9.0.0",
  nodePath: "/usr/bin/node",
  telemetryId: "telemetry-id",
  telemetryConsent: "opted_in",
  telemetryUrl: "https://example.test",
  dyadVersion: "1.2.3",
  platform: "linux",
  architecture: "x64",
  logs: "logs",
  updaterLogs: null,
  selectedLanguageModel: "auto",
};

const bundle = {
  chat: { messages: [{ id: 1, role: "user", content: "hi" }] },
  codebase: "codebase",
  logs: "logs",
  updaterLogs: null,
  system: debugInfo,
  settings: {},
  app: {},
  providers: [],
  mcpServers: [],
};

function OpenHelpDialog() {
  const setHelpDialog = useSetAtom(helpDialogAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  useEffect(() => {
    setSelectedChatId(1);
    setHelpDialog({ open: true });
  }, [setHelpDialog, setSelectedChatId]);
  return (
    <>
      {/* Stands in for the sidebar's Help button. */}
      <button onClick={() => setHelpDialog({ open: true })}>reopen-help</button>
      {/* Stands in for ForceCloseDialog's crash-triggered report. */}
      <button onClick={() => setHelpDialog({ open: true, uploadChatId: 42 })}>
        force-close-report
      </button>
      {/* Stands in for having no chat open. */}
      <button onClick={() => setSelectedChatId(null)}>clear-chat</button>
      <HelpDialog />
    </>
  );
}

/**
 * A fresh store per test. Without it the crash-report atom set by one test is
 * still live when the next one mounts, and HelpDialog's effects run before the
 * harness can clear it.
 */
function renderHelp() {
  return render(
    <Provider store={createStore()}>
      <OpenHelpDialog />
    </Provider>,
  );
}

function urlOfOpenedIssue(): URL {
  return new URL(mocks.openExternalUrl.mock.calls.at(-1)?.[0] as string);
}

function bodyOfOpenedIssue(): string {
  return urlOfOpenedIssue().searchParams.get("body") ?? "";
}

/** Help -> Report a Bug -> a filled-in form. */
async function openForm(description = "the preview goes blank") {
  renderHelp();
  fireEvent.click(await screen.findByText("Report a Bug"));
  const field = await screen.findByLabelText(/What happened/);
  fireEvent.change(field, { target: { value: description } });
  return field as HTMLTextAreaElement;
}

const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: /Create GitHub issue/ }));

const fileIt = async () => {
  submit();
  await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSystemDebugInfo.mockResolvedValue(debugInfo);
  mocks.getSessionDebugBundle.mockResolvedValue(bundle);
  mocks.uploadToSignedUrl.mockResolvedValue(undefined);
  mocks.recopyScreenshot.mockResolvedValue({ copied: true });
  mocks.takeScreenshot.mockResolvedValue({
    dataUrl: "data:image/png;base64,AAAA",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        uploadUrl: "https://upload.test/signed",
        filename: "abc.json",
      }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HelpDialog report flow", () => {
  it("goes straight from Help to the form", async () => {
    renderHelp();
    fireEvent.click(await screen.findByText("Report a Bug"));

    expect(await screen.findByLabelText(/What happened/)).toBeTruthy();
    expect(posthogClient.capture).toHaveBeenCalledWith("issue-form:opened", {
      source: "report-bug",
    });
  });

  it("files the report with the description in the body", async () => {
    await openForm("the preview goes blank after a branch switch");
    await fileIt();

    const body = bodyOfOpenedIssue();
    expect(body).toContain("the preview goes blank after a branch switch");
    expect(body).toContain("Screenshot status: declined");
    expect(urlOfOpenedIssue().searchParams.get("labels")).toContain("bug");
  });

  it("will not submit without a description of some substance", async () => {
    renderHelp();
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/What happened/), {
      target: { value: "asdf" },
    });

    submit();

    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "Please describe what happened",
    );
    expect(document.activeElement?.id).toBe("issue-description");
  });

  it("accepts a short but real description", async () => {
    await openForm("it crashed");
    await fileIt();
    expect(bodyOfOpenedIssue()).toContain("it crashed");
  });

  it("treats whitespace as empty and clears the message once filled", async () => {
    renderHelp();
    fireEvent.click(await screen.findByText("Report a Bug"));
    const field = await screen.findByLabelText(/What happened/);
    fireEvent.change(field, { target: { value: "          " } });
    submit();
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.change(field, { target: { value: "it goes blank" } });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops typing at the cap and says where to finish", async () => {
    const field = await openForm("x".repeat(PROSE_BUDGET + 200));

    expect(field.value).toHaveLength(PROSE_BUDGET);
    expect(
      screen.getByText(/You can finish writing your description on GitHub/),
    ).toBeTruthy();
  });

  it("leaves the caret where it was when an edit is clipped", async () => {
    const field = await openForm("a".repeat(PROSE_BUDGET));

    // Type one character ten in: there is no room, so it cannot land.
    fireEvent.change(field, {
      target: {
        value: "a".repeat(10) + "X" + "a".repeat(PROSE_BUDGET - 10),
        selectionStart: 11,
        selectionEnd: 11,
      },
    });

    expect(field.value).toBe("a".repeat(PROSE_BUDGET));
    expect(field.selectionStart).toBe(10);
  });

  it("reports the gate once per form, not once per click", async () => {
    renderHelp();
    fireEvent.click(await screen.findByText("Report a Bug"));

    submit();
    submit();
    submit();

    const blocked = posthogClient.capture.mock.calls.filter(
      (call) => call[0] === "issue-form:blocked",
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0][1]).toEqual({ source: "report-bug" });
  });

  it("reports the gate once per form even across a capture", async () => {
    renderHelp();
    fireEvent.click(await screen.findByText("Report a Bug"));

    submit();
    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
    await screen.findByAltText("Screenshot copied to your clipboard");
    submit();

    const blocked = posthogClient.capture.mock.calls.filter(
      (call) => call[0] === "issue-form:blocked",
    );
    expect(blocked).toHaveLength(1);
  });

  it("re-reads diagnostics for each report after a failed read", async () => {
    mocks.getSystemDebugInfo.mockRejectedValueOnce(new Error("no debug info"));

    renderHelp();
    fireEvent.click(await screen.findByText("Report a Bug"));
    expect(
      await screen.findByText(/Diagnostics could not be read/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByText("Report a Bug"));

    // The next report gets its own read rather than inheriting the failure.
    await waitFor(() =>
      expect(screen.queryByText(/Diagnostics could not be read/)).toBeNull(),
    );
  });

  it("keeps the draft when the reporter closes the dialog mid-form", async () => {
    await openForm("half-written report");

    fireEvent.click(screen.getByText("mock-dialog-dismiss"));
    fireEvent.click(screen.getByText("reopen-help"));

    expect(await screen.findByDisplayValue("half-written report")).toBeTruthy();
  });

  it("abandons the draft when the reporter backs out", async () => {
    await openForm("never mind");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByText("Need help with Dyad?")).toBeTruthy();
    fireEvent.click(screen.getByText("Report a Bug"));
    expect(
      ((await screen.findByLabelText(/What happened/)) as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });
});

describe("HelpDialog disclosures", () => {
  it("sends system information and a session by default", async () => {
    await openForm();
    await fileIt();

    const body = bodyOfOpenedIssue();
    expect(body).toContain("- Dyad Version:");
    expect(body).toContain("Session ID: v2:abc");
    expect(mocks.uploadToSignedUrl).toHaveBeenCalled();
  });

  it("leaves system information out when it is unticked", async () => {
    await openForm();
    fireEvent.click(
      await screen.findByLabelText("Basic system information and logs"),
    );
    await fileIt();

    const body = bodyOfOpenedIssue();
    expect(body).toContain(
      "## System Information\nNot included by the reporter.",
    );
    expect(body).not.toContain("- Dyad Version:");
  });

  it("does not upload the session when it is unticked", async () => {
    await openForm();
    fireEvent.click(await screen.findByLabelText("Chat session"));
    await fileIt();

    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
    expect(bodyOfOpenedIssue()).not.toContain("Session ID");
  });

  it("offers no session when there is no chat open", async () => {
    renderHelp();
    fireEvent.click(screen.getByText("clear-chat"));
    fireEvent.click(await screen.findByText("Report a Bug"));

    expect(
      (screen.getByLabelText("Chat session") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText("Open a chat first to include a session."),
    ).toBeTruthy();
  });

  it("loads the session only when the disclosure is expanded", async () => {
    await openForm();
    expect(mocks.getSessionDebugBundle).not.toHaveBeenCalled();

    const summaries = screen.getAllByText("Show what will be sent");
    fireEvent.click(summaries[summaries.length - 1]);

    await waitFor(() =>
      expect(mocks.getSessionDebugBundle).toHaveBeenCalledWith(1),
    );
  });

  it("does not let consent be withdrawn after it has been acted on", async () => {
    let release = (_: unknown) => {};
    mocks.uploadToSignedUrl.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm();
    submit();
    await screen.findByRole("button", { name: /Preparing your report/ });

    // The upload is already running, so the box must not look changeable.
    const box = screen.getByLabelText("Chat session") as HTMLInputElement;
    expect(box.disabled).toBe(true);

    release(undefined);
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
  });

  it("does not tear down a newer report when an earlier filing finishes", async () => {
    let release = (_: unknown) => {};
    mocks.uploadToSignedUrl.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm("the first problem");
    submit();
    await screen.findByRole("button", { name: /Preparing your report/ });

    // Backing out mid-filing is refused, so the reporter cannot strand
    // themselves between two reports.
    const back = screen.getByRole("button", {
      name: "Back",
    }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);

    release(undefined);
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(bodyOfOpenedIssue()).toContain("the first problem");
  });

  it("says diagnostics were unavailable rather than declined", async () => {
    mocks.getSystemDebugInfo.mockRejectedValue(new Error("no debug info"));
    await openForm();
    await fileIt();

    // A maintainer has to be able to tell a failed read from a reporter who
    // chose not to share.
    const body = bodyOfOpenedIssue();
    expect(body).toContain("Could not be collected on this machine.");
    expect(body).not.toContain("Not included by the reporter.");
  });

  it("keeps the dialog up while the report is being filed", async () => {
    let release = (_: unknown) => {};
    mocks.uploadToSignedUrl.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm();
    submit();

    // Serialising a codebase and uploading it takes time; the reporter needs
    // to see that something is happening and must not start a second report.
    const button = (await screen.findByRole("button", {
      name: /Preparing your report/,
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();

    release(undefined);
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
  });

  it("still files the report when the session upload fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await openForm("the preview goes blank");
    await fileIt();

    const body = bodyOfOpenedIssue();
    expect(body).toContain("the preview goes blank");
    expect(body).not.toContain("Session ID");
  });

  it("discards a session read that lands after its report is gone", async () => {
    let release = (_: unknown) => {};
    mocks.getSessionDebugBundle.mockImplementation((id: number) =>
      id === 42
        ? new Promise((resolve) => {
            release = () => resolve({ ...bundle, codebase: "codebase-42" });
          })
        : Promise.resolve({ ...bundle, codebase: `codebase-${id}` }),
    );

    renderHelp();
    await screen.findByText("Need help with Dyad?");
    fireEvent.click(screen.getByText("force-close-report"));
    await screen.findByLabelText(/What happened/);

    // Reading a session serialises the whole codebase, so it can be slow.
    const summaries = screen.getAllByText("Show what will be sent");
    fireEvent.click(summaries[summaries.length - 1]);
    await waitFor(() =>
      expect(mocks.getSessionDebugBundle).toHaveBeenCalledWith(42),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/What happened/), {
      target: { value: "a different problem" },
    });

    // The abandoned read lands while the new report is on screen. Flushed so
    // the state write happens before the report is submitted, which is the
    // whole point of the test.
    await act(async () => {
      release(null);
    });

    submit();
    await waitFor(() => expect(mocks.uploadToSignedUrl).toHaveBeenCalled());
    expect(mocks.uploadToSignedUrl.mock.calls.at(-1)?.[0]?.data.codebase).toBe(
      "codebase-1",
    );
  });

  it("uploads the session for the report's own chat", async () => {
    mocks.getSessionDebugBundle.mockImplementation((id: number) =>
      Promise.resolve({ ...bundle, codebase: `codebase-${id}` }),
    );

    renderHelp();
    await screen.findByText("Need help with Dyad?");
    fireEvent.click(screen.getByText("force-close-report"));
    await screen.findByLabelText(/What happened/);

    // Look at what the crash report would send, then abandon it.
    const summaries = screen.getAllByText("Show what will be sent");
    fireEvent.click(summaries[summaries.length - 1]);
    await waitFor(() =>
      expect(mocks.getSessionDebugBundle).toHaveBeenCalledWith(42),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/What happened/), {
      target: { value: "a different problem" },
    });
    submit();
    await waitFor(() => expect(mocks.uploadToSignedUrl).toHaveBeenCalled());

    const sent = mocks.uploadToSignedUrl.mock.calls.at(-1)?.[0]?.data;
    expect(sent.codebase).toBe("codebase-1");
  });

  it("uploads the crashed chat, not whichever chat is selected", async () => {
    renderHelp();
    await screen.findByText("Need help with Dyad?");
    fireEvent.click(screen.getByText("force-close-report"));
    await screen.findByLabelText(/What happened/);
    fireEvent.change(screen.getByLabelText(/What happened/), {
      target: { value: "it crashed on me" },
    });

    // The dialog closes and reopens for the capture.
    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
    await screen.findByAltText("Screenshot copied to your clipboard");

    submit();
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());

    expect(mocks.getSessionDebugBundle).toHaveBeenCalledWith(42);
    expect(mocks.getSessionDebugBundle).not.toHaveBeenCalledWith(1);
  });

  it("keeps the session offer after the dialog reopens with no chat selected", async () => {
    renderHelp();
    await screen.findByText("Need help with Dyad?");
    fireEvent.click(screen.getByText("clear-chat"));
    fireEvent.click(screen.getByText("force-close-report"));
    await screen.findByLabelText(/What happened/);
    expect(
      (screen.getByLabelText("Chat session") as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
    await screen.findByAltText("Screenshot copied to your clipboard");

    // The reporter agreed to send the session; it must not quietly withdraw.
    const box = screen.getByLabelText("Chat session") as HTMLInputElement;
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(true);
  });

  it("counts a crash-opened form like any other report", async () => {
    renderHelp();
    await screen.findByText("Need help with Dyad?");
    fireEvent.click(screen.getByText("force-close-report"));
    await screen.findByLabelText(/What happened/);

    expect(posthogClient.capture).toHaveBeenCalledWith("issue-form:opened", {
      source: "report-bug",
    });
  });

  it("opens the form with the session ticked after a force-close", async () => {
    renderHelp();
    await screen.findByText("Need help with Dyad?");

    fireEvent.click(screen.getByText("force-close-report"));

    expect(await screen.findByLabelText(/What happened/)).toBeTruthy();
    expect(
      (screen.getByLabelText("Chat session") as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("HelpDialog screenshot", () => {
  const addScreenshot = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
    return screen.findByAltText("Screenshot copied to your clipboard");
  };

  it("captures from the form and shows it before it is sent", async () => {
    await openForm();

    const preview = (await addScreenshot()) as HTMLImageElement;

    expect(preview.src).toContain("data:image/png");
    expect(posthogClient.capture).toHaveBeenCalledWith(
      "screenshot-prompt:captured",
      { source: "report-bug" },
    );
  });

  it("records a captured screenshot in the issue", async () => {
    await openForm();
    await addScreenshot();
    submit();

    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(bodyOfOpenedIssue()).toContain("Screenshot status: captured");
  });

  it("records a decline when the reporter files without one", async () => {
    await openForm();
    submit();

    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(bodyOfOpenedIssue()).toContain("Screenshot status: declined");
  });

  it("goes back to declined when the screenshot is removed", async () => {
    await openForm();
    await addScreenshot();

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    expect(
      screen.queryByAltText("Screenshot copied to your clipboard"),
    ).toBeNull();

    submit();
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(bodyOfOpenedIssue()).toContain("Screenshot status: declined");
  });

  it("keeps the draft while the dialog hides for the capture", async () => {
    await openForm("half-written report");
    await addScreenshot();

    // The dialog closes to stay out of the picture, then comes back with the
    // description still there.
    expect(screen.getByDisplayValue("half-written report")).toBeTruthy();
  });

  it("does not carry a screenshot into the next report", async () => {
    await openForm("first report");
    await addScreenshot();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByText("Report a Bug"));

    expect(
      screen.queryByAltText("Screenshot copied to your clipboard"),
    ).toBeNull();

    fireEvent.change(await screen.findByLabelText(/What happened/), {
      target: { value: "a different problem" },
    });
    submit();
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(bodyOfOpenedIssue()).toContain("Screenshot status: declined");
  });

  it("drops a capture that lands after the draft was replaced", async () => {
    let release = (_: unknown) => {};
    mocks.takeScreenshot.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm("first report");
    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());

    // The reporter reopens Help mid-capture and starts over.
    fireEvent.click(screen.getByText("reopen-help"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByText("Report a Bug"));

    release({ dataUrl: "data:image/png;base64,AAAA" });

    await waitFor(() =>
      expect(screen.getByLabelText(/What happened/)).toBeTruthy(),
    );
    expect(
      screen.queryByAltText("Screenshot copied to your clipboard"),
    ).toBeNull();
  });

  it("leaves the screenshot button usable after a discarded capture", async () => {
    let release = (_: unknown) => {};
    mocks.takeScreenshot.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm("first report");
    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());

    fireEvent.click(screen.getByText("reopen-help"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByText("Report a Bug"));

    release({ dataUrl: "data:image/png;base64,AAAA" });

    await waitFor(() =>
      expect(screen.getByLabelText(/What happened/)).toBeTruthy(),
    );
    const button = screen.getByRole("button", {
      name: /Add a screenshot/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("puts the capture back on the clipboard as the report is filed", async () => {
    await openForm();
    await addScreenshot();
    submit();
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());

    // Ordering is the point: the clipboard has to be right before the browser
    // opens, not after the reporter has already been sent there.
    expect(mocks.recopyScreenshot).toHaveBeenCalled();
    expect(mocks.recopyScreenshot.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openExternalUrl.mock.invocationCallOrder[0],
    );
  });

  it("does not touch the clipboard when there is no screenshot", async () => {
    await openForm();
    submit();
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());

    expect(mocks.recopyScreenshot).not.toHaveBeenCalled();
  });

  it("records a failed capture and still lets the report go", async () => {
    mocks.takeScreenshot.mockRejectedValue(
      new Error("No focused window to capture"),
    );
    await openForm();

    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(posthogClient.capture).toHaveBeenCalledWith(
      "screenshot-prompt:capture-failed",
      { source: "report-bug", failure: "no-focused-window" },
    );

    submit();
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(bodyOfOpenedIssue()).toContain("Screenshot status: capture-failed");
  });
});
