import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSetAtom } from "jotai";
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
  showInfo: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    system: {
      getSystemDebugInfo: mocks.getSystemDebugInfo,
      openExternalUrl: mocks.openExternalUrl,
      uploadToSignedUrl: mocks.uploadToSignedUrl,
      takeScreenshot: mocks.takeScreenshot,
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
      {/* Stands in for ForceCloseDialog's crash-triggered upload. */}
      <button onClick={() => setHelpDialog({ open: true, uploadChatId: 42 })}>
        force-close-upload
      </button>
      <HelpDialog />
    </>
  );
}

/**
 * The form sits between every entry point and the screenshot prompt, and its
 * title and description are required, so a test that means to reach the prompt
 * fills them the way a reporter would. Existing values are left alone.
 */
async function leaveFormForScreenshot() {
  const next = await screen.findByText("Next: add a screenshot");
  // Session reports require expected/actual as well; those inputs are absent
  // on the bug form, so fill whichever the current form renders.
  for (const [id, value] of [
    ["issue-title", "Test report"],
    ["issue-description", "Test description"],
    ["issue-expected", "Test expected"],
    ["issue-actual", "Test actual"],
  ]) {
    const field = document.getElementById(id) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    if (field && !field.value) {
      fireEvent.change(field, { target: { value } });
    }
  }
  fireEvent.click(next);
}

/** Walks the upload flow up to the screen that offers to create the issue. */
async function reachUploadCompleteScreen() {
  render(<OpenHelpDialog />);
  fireEvent.click(await screen.findByText("Upload Chat Session"));
  fireEvent.click(await screen.findByRole("button", { name: /^Upload$/ }));
  await screen.findByText("Upload Complete");
}

function titleOfOpenedIssue(): string {
  const url = mocks.openExternalUrl.mock.calls.at(-1)?.[0] as string;
  return new URL(url).searchParams.get("title") ?? "";
}

function bodyOfOpenedIssue(): string {
  const url = mocks.openExternalUrl.mock.calls.at(-1)?.[0] as string;
  return new URL(url).searchParams.get("body") ?? "";
}

describe("HelpDialog screenshot prompt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemDebugInfo.mockResolvedValue(debugInfo);
    mocks.takeScreenshot.mockResolvedValue({
      dataUrl: "data:image/png;base64,AAAA",
    });
    mocks.getSessionDebugBundle.mockResolvedValue(bundle);
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
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

  it("offers the screenshot prompt before creating a session issue", async () => {
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await leaveFormForScreenshot();

    expect(await screen.findByText("Take a screenshot?")).toBeTruthy();
    expect(posthogClient.capture).toHaveBeenCalledWith(
      "screenshot-prompt:shown",
      { source: "upload-session" },
    );
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("keeps the session ID after the prompt closes the help dialog", async () => {
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await leaveFormForScreenshot();
    fireEvent.click(await screen.findByText("Create issue without screenshot"));

    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    const body = bodyOfOpenedIssue();
    expect(body).toContain("Session ID: v2:abc");
    expect(body).toContain("Screenshot status: declined");
  });

  it("records a captured screenshot in the session issue", async () => {
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await leaveFormForScreenshot();
    fireEvent.click(await screen.findByRole("button", { name: /recommended/ }));
    fireEvent.click(await screen.findByText("Create GitHub issue"));

    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    const body = bodyOfOpenedIssue();
    expect(body).toContain("Session ID: v2:abc");
    expect(body).toContain("Screenshot status: captured");
  });

  it("returns a dismissed prompt to the form with the draft intact", async () => {
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    fireEvent.change(await screen.findByLabelText(/What is the issue/), {
      target: { value: "bad output" },
    });
    await leaveFormForScreenshot();
    await screen.findByText("Take a screenshot?");

    fireEvent.click(screen.getByText("mock-dialog-dismiss"));

    // Back where they were, with what they typed still on screen, rather than
    // stranded with the upload orphaned.
    expect(await screen.findByText("Describe the issue")).toBeTruthy();
    expect(screen.getByDisplayValue("bad output")).toBeTruthy();
    expect(screen.queryByText("Take a screenshot?")).toBeNull();
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();

    // And the recovered form still files a complete issue.
    await leaveFormForScreenshot();
    fireEvent.click(await screen.findByText("Create issue without screenshot"));
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    const body = bodyOfOpenedIssue();
    expect(body).toContain("Session ID: v2:abc");
    expect(body).toContain("bad output");
  });

  it("reports progress outside the prompt once it is answered", async () => {
    let releaseDebugInfo = (_: unknown) => {};
    mocks.getSystemDebugInfo.mockReturnValue(
      new Promise((resolve) => {
        releaseDebugInfo = resolve;
      }),
    );

    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    await leaveFormForScreenshot();
    fireEvent.click(
      await screen.findByText("File bug report without screenshot"),
    );

    // The prompt is finished the moment it is answered, and gathering logs
    // takes a moment, so progress is reported outside the dialog.
    await waitFor(() =>
      expect(screen.queryByText("Take a screenshot?")).toBeNull(),
    );
    expect(mocks.showInfo).toHaveBeenCalled();
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();

    releaseDebugInfo(debugInfo);
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
  });

  it("leaves the reporter's dialogs alone while a report is prepared", async () => {
    let releaseDebugInfo = (_: unknown) => {};
    mocks.getSystemDebugInfo.mockReturnValue(
      new Promise((resolve) => {
        releaseDebugInfo = resolve;
      }),
    );

    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await leaveFormForScreenshot();
    fireEvent.click(await screen.findByText("Create issue without screenshot"));
    await waitFor(() =>
      expect(screen.queryByText("Take a screenshot?")).toBeNull(),
    );

    // The reporter goes back into help while the report is still being built.
    fireEvent.click(screen.getByText("reopen-help"));
    expect(await screen.findByText("Need help with Dyad?")).toBeTruthy();

    releaseDebugInfo(debugInfo);
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());

    // The arriving report files correctly and does not touch what is on screen.
    expect(bodyOfOpenedIssue()).toContain("Session ID: v2:abc");
    expect(screen.getByText("Need help with Dyad?")).toBeTruthy();
  });

  it("reports a dismissal so every opening has an outcome", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    await leaveFormForScreenshot();
    await screen.findByText("Take a screenshot?");

    fireEvent.click(screen.getByText("mock-dialog-dismiss"));

    expect(posthogClient.capture).toHaveBeenCalledWith(
      "screenshot-prompt:dismissed",
      { source: "report-bug" },
    );
  });

  it("files a second report started while the first is still preparing", async () => {
    const releases: ((value: unknown) => void)[] = [];
    mocks.getSystemDebugInfo.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }),
    );

    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await leaveFormForScreenshot();
    fireEvent.click(await screen.findByText("Create issue without screenshot"));
    await waitFor(() =>
      expect(screen.queryByText("Take a screenshot?")).toBeNull(),
    );

    fireEvent.click(screen.getByText("reopen-help"));
    fireEvent.click(await screen.findByText("Report a Bug"));
    await leaveFormForScreenshot();
    fireEvent.click(
      await screen.findByText("File bug report without screenshot"),
    );

    // The form loads diagnostics for its disclosure as well as the report, so
    // release whatever is outstanding until both reports have filed.
    await waitFor(() => {
      releases.forEach((release) => release(debugInfo));
      expect(mocks.openExternalUrl).toHaveBeenCalledTimes(2);
    });

    // Each report carries its own data rather than the other one's.
    const bodies = mocks.openExternalUrl.mock.calls.map(
      (call) => new URL(call[0] as string).searchParams.get("body") ?? "",
    );
    expect(bodies.some((body) => body.includes("Session ID: v2:abc"))).toBe(
      true,
    );
    expect(
      bodies.some((body) => body.includes("## Bug Description (required)")),
    ).toBe(true);
  });

  it("keeps the screenshot status when debug info cannot be gathered", async () => {
    mocks.getSystemDebugInfo.mockRejectedValue(new Error("no debug info"));

    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));

    // The disclosure says so rather than sitting on its spinner forever.
    expect(
      await screen.findByText(/Diagnostics could not be read/),
    ).toBeTruthy();

    await leaveFormForScreenshot();
    fireEvent.click(
      await screen.findByText("File bug report without screenshot"),
    );

    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(bodyOfOpenedIssue()).toContain("Screenshot status: declined");
  });

  it("abandoning a late capture leaves a newer prompt alone", async () => {
    let releaseCapture = () => {};
    mocks.takeScreenshot.mockReturnValue(
      new Promise((resolve) => {
        releaseCapture = () =>
          resolve({ dataUrl: "data:image/png;base64,AAAA" });
      }),
    );

    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await leaveFormForScreenshot();
    fireEvent.click(await screen.findByRole("button", { name: /recommended/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());

    // A second report starts while the first capture is still resolving. The
    // reopened dialog keeps the form, so it starts there.
    fireEvent.click(screen.getByText("reopen-help"));
    await leaveFormForScreenshot();
    await screen.findByText("Take a screenshot?");

    // The first capture lands and stacks its success dialog on top.
    releaseCapture();
    const dismissals = await waitFor(() => {
      const found = screen.getAllByText("mock-dialog-dismiss");
      expect(found.length).toBeGreaterThan(1);
      return found;
    });

    // Abandoning it must not take the newer prompt down with it.
    fireEvent.click(dismissals[dismissals.length - 1]);
    expect(screen.getByText("Take a screenshot?")).toBeTruthy();
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("returns to help when an abandoned capture is the last thing on screen", async () => {
    const releases: (() => void)[] = [];
    mocks.takeScreenshot.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() =>
            resolve({ dataUrl: "data:image/png;base64,AAAA" }),
          );
        }),
    );

    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await leaveFormForScreenshot();
    fireEvent.click(await screen.findByRole("button", { name: /recommended/ }));
    await waitFor(() => expect(releases).toHaveLength(1));

    // A second report is started and answered while the first still hangs.
    fireEvent.click(screen.getByText("reopen-help"));
    await leaveFormForScreenshot();
    fireEvent.click(await screen.findByRole("button", { name: /recommended/ }));
    await waitFor(() => expect(releases).toHaveLength(2));

    // They land out of order, so the dialog on screen is not the newest report.
    releases[1]();
    await screen.findByText("Create GitHub issue");
    releases[0]();

    const dismissals = screen.getAllByText("mock-dialog-dismiss");
    fireEvent.click(dismissals[dismissals.length - 1]);

    // With no prompt left open, backing out has to land somewhere.
    expect(await screen.findByText("Describe the issue")).toBeTruthy();
  });

  it("still offers the prompt on the bug report path", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    await leaveFormForScreenshot();

    expect(await screen.findByText("Take a screenshot?")).toBeTruthy();
    expect(posthogClient.capture).toHaveBeenCalledWith(
      "screenshot-prompt:shown",
      { source: "report-bug" },
    );

    fireEvent.click(screen.getByText("File bug report without screenshot"));
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(bodyOfOpenedIssue()).toContain("Screenshot status: declined");
  });
});

describe("HelpDialog issue form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemDebugInfo.mockResolvedValue(debugInfo);
    mocks.getSessionDebugBundle.mockResolvedValue(bundle);
    mocks.takeScreenshot.mockResolvedValue({
      dataUrl: "data:image/png;base64,AAAA",
    });
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
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

  it("carries what the reporter typed into the issue", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));

    fireEvent.change(await screen.findByLabelText(/^Title/), {
      target: { value: "Preview goes blank" },
    });
    fireEvent.change(screen.getByLabelText(/What went wrong/), {
      target: { value: "Switching branches blanks the preview." },
    });

    await leaveFormForScreenshot();
    fireEvent.click(
      await screen.findByText("File bug report without screenshot"),
    );

    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(titleOfOpenedIssue()).toBe("[bug] Preview goes blank");
    expect(bodyOfOpenedIssue()).toContain(
      "Switching branches blanks the preview.",
    );
  });

  it("takes over a suspended draft when a crash upload arrives", async () => {
    let release = () => {};
    mocks.getSessionDebugBundle.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(bundle);
      }),
    );

    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/What went wrong/), {
      target: { value: "half-written report" },
    });
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));

    // The dialog is suspended on the form when the app force-closes.
    fireEvent.click(screen.getByText("force-close-upload"));

    // The spinner covers the bundle wait, which is what it is for; the stale
    // draft must not be sitting there instead.
    expect(await screen.findByText("home:help.preparingUpload")).toBeTruthy();
    expect(screen.queryByDisplayValue("half-written report")).toBeNull();

    release();
    expect(await screen.findByText("OK to upload chat session?")).toBeTruthy();

    // The spinner alone would hide a surviving draft, so prove it was really
    // released: a live reportKind suppresses resetDialogState for the rest of
    // the session, which shows up as a stale screen on the next open.
    fireEvent.click(screen.getByRole("button", { name: /^Upload$/ }));
    await screen.findByText("Upload Complete");
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));
    fireEvent.click(screen.getByText("reopen-help"));

    expect(await screen.findByText("Need help with Dyad?")).toBeTruthy();
  });

  it("preloads again on a repeat force-close for the same chat", async () => {
    render(<OpenHelpDialog />);
    await screen.findByText("Need help with Dyad?");

    // First crash upload runs the whole way to the form.
    fireEvent.click(screen.getByText("force-close-upload"));
    await screen.findByText("OK to upload chat session?");
    fireEvent.click(screen.getByRole("button", { name: /^Upload$/ }));
    await screen.findByText("Upload Complete");
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await screen.findByLabelText(/What is the issue/);
    expect(mocks.getSessionDebugBundle).toHaveBeenCalledTimes(1);

    // The reporter closes the dialog on the form, so the draft is kept -- but
    // the preload guard must not be, or the next crash silently does nothing.
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));
    fireEvent.click(screen.getByText("force-close-upload"));

    expect(await screen.findByText("OK to upload chat session?")).toBeTruthy();
    expect(mocks.getSessionDebugBundle).toHaveBeenCalledTimes(2);
  });

  it("counts every report started, as the denominator for the gate", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));

    expect(posthogClient.capture).toHaveBeenCalledWith("issue-form:opened", {
      source: "report-bug",
    });

    // Reopening a suspended draft is not a new report, so it must not count.
    posthogClient.capture.mockClear();
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));
    fireEvent.click(screen.getByText("reopen-help"));
    await screen.findByLabelText(/What went wrong/);
    expect(posthogClient.capture).not.toHaveBeenCalledWith(
      "issue-form:opened",
      expect.anything(),
    );
  });

  it("re-announces the same error when Continue is clicked again", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));

    fireEvent.click(screen.getByText("Next: add a screenshot"));
    const title = screen.getByLabelText(/^Title/);
    expect(title.getAttribute("aria-describedby")).toBe("issue-title-error");
    expect(screen.getByRole("alert").id).toBe("issue-title-error");

    // Focus moves elsewhere, then the reporter tries again without filling it.
    (screen.getByLabelText(/What went wrong/) as HTMLTextAreaElement).focus();
    fireEvent.click(screen.getByText("Next: add a screenshot"));

    expect(document.activeElement?.id).toBe("issue-title");
  });

  it("will not leave the form without a title", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/What went wrong/), {
      target: { value: "the preview is blank" },
    });

    fireEvent.click(screen.getByText("Next: add a screenshot"));

    expect(screen.queryByText("Take a screenshot?")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("add a title");
    expect(document.activeElement?.id).toBe("issue-title");
    expect(posthogClient.capture).toHaveBeenCalledWith("issue-form:blocked", {
      source: "report-bug",
      field: "title",
    });
  });

  it("will not leave the form without a description", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/^Title/), {
      target: { value: "Preview goes blank" },
    });

    fireEvent.click(screen.getByText("Next: add a screenshot"));

    expect(screen.queryByText("Take a screenshot?")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Please describe the issue",
    );
    expect(document.activeElement?.id).toBe("issue-description");
    expect(posthogClient.capture).toHaveBeenCalledWith("issue-form:blocked", {
      source: "report-bug",
      field: "description",
    });
  });

  it("treats whitespace as empty and clears the message once filled", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/^Title/), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByText("Next: add a screenshot"));
    expect(screen.getByRole("alert").textContent).toContain("add a title");

    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "A real title" },
    });

    // Derived from the field, so it goes as soon as they type rather than
    // waiting for another attempt.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports the session flow's gate against its own source", async () => {
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await screen.findByText("Next: add a screenshot");

    fireEvent.click(screen.getByText("Next: add a screenshot"));

    expect(posthogClient.capture).toHaveBeenCalledWith("issue-form:blocked", {
      source: "upload-session",
      field: "title",
    });
  });

  it("requires the session report's expected and actual behaviour", async () => {
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    fireEvent.change(await screen.findByLabelText(/^Title/), {
      target: { value: "Bad output" },
    });
    fireEvent.change(screen.getByLabelText(/What is the issue/), {
      target: { value: "the generated page is blank" },
    });

    // Blocked on expected first, then actual, in the order they are shown.
    fireEvent.click(screen.getByText("Next: add a screenshot"));
    expect(document.activeElement?.id).toBe("issue-expected");
    expect(screen.getByRole("alert").textContent).toContain(
      "what you expected",
    );

    fireEvent.change(screen.getByLabelText(/Expected behavior/), {
      target: { value: "a rendered page" },
    });
    fireEvent.click(screen.getByText("Next: add a screenshot"));
    expect(document.activeElement?.id).toBe("issue-actual");

    fireEvent.change(screen.getByLabelText(/Actual behavior/), {
      target: { value: "a white screen" },
    });
    fireEvent.click(screen.getByText("Next: add a screenshot"));
    expect(await screen.findByText("Take a screenshot?")).toBeTruthy();
  });

  it("does not require expected and actual on the bug form", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/^Title/), {
      target: { value: "Preview blank" },
    });
    fireEvent.change(screen.getByLabelText(/What went wrong/), {
      target: { value: "it goes blank" },
    });

    fireEvent.click(screen.getByText("Next: add a screenshot"));

    expect(await screen.findByText("Take a screenshot?")).toBeTruthy();
  });

  it("stops typing at the cap and says where to finish", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));

    const description = await screen.findByLabelText(/What went wrong/);
    fireEvent.change(description, {
      target: { value: "x".repeat(PROSE_BUDGET + 200) },
    });

    // What fits lands; the rest is visibly absent rather than dropped later.
    expect((description as HTMLTextAreaElement).value).toHaveLength(
      PROSE_BUDGET,
    );
    expect(
      screen.getByText(/You can finish writing your description on GitHub/),
    ).toBeTruthy();
  });

  it("keeps the session report's required fields fillable at the cap", async () => {
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));

    // The budget is shared, so an over-long description is clamped -- but not
    // so far that the fields the gate requires become untypeable.
    fireEvent.change(await screen.findByLabelText(/What is the issue/), {
      target: { value: "y".repeat(4_000) },
    });
    fireEvent.change(screen.getByLabelText(/Expected behavior/), {
      target: { value: "a rendered page" },
    });
    fireEvent.change(screen.getByLabelText(/Actual behavior/), {
      target: { value: "a white screen" },
    });

    expect(
      (screen.getByLabelText(/Expected behavior/) as HTMLTextAreaElement).value,
    ).toBe("a rendered page");
    expect(
      (screen.getByLabelText(/Actual behavior/) as HTMLTextAreaElement).value,
    ).toBe("a white screen");

    // And the gate lets them through rather than demanding the impossible.
    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "Blank page" },
    });
    fireEvent.click(screen.getByText("Next: add a screenshot"));
    expect(await screen.findByText("Take a screenshot?")).toBeTruthy();
  });

  it("keeps the draft when the reporter closes the dialog mid-form", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/What went wrong/), {
      target: { value: "half-written report" },
    });

    fireEvent.click(screen.getByText("mock-dialog-dismiss"));
    fireEvent.click(screen.getByText("reopen-help"));

    expect(await screen.findByDisplayValue("half-written report")).toBeTruthy();
  });

  it("leaves no empty screen when a report files while the dialog is open", async () => {
    let releaseCapture = () => {};
    mocks.takeScreenshot.mockReturnValue(
      new Promise((resolve) => {
        releaseCapture = () =>
          resolve({ dataUrl: "data:image/png;base64,AAAA" });
      }),
    );

    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await leaveFormForScreenshot();
    fireEvent.click(await screen.findByRole("button", { name: /recommended/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());

    // The reporter reopens help while the capture is still running, so the
    // dialog is on the form when the report below dispatches and releases it.
    fireEvent.click(screen.getByText("reopen-help"));
    await screen.findByText("Describe the issue");

    releaseCapture();
    fireEvent.click(await screen.findByText("Create GitHub issue"));
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());

    // Dispatching clears the draft, which leaves the form with nothing to
    // render; the dialog has to land somewhere rather than go blank.
    expect(await screen.findByText("Upload Complete")).toBeTruthy();
  });

  it("returns a session report to the upload screen when backing out", async () => {
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await screen.findByLabelText(/What is the issue/);

    fireEvent.click(screen.getByText("Back"));

    // Backing out to the main screen would strand the upload: the session ID
    // is only shown here, and this is the only route to filing against it.
    expect(await screen.findByText("Upload Complete")).toBeTruthy();
    expect(screen.getByText("v2:abc")).toBeTruthy();
  });

  it("abandons the draft when the reporter backs out of the form", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/What went wrong/), {
      target: { value: "never mind" },
    });

    fireEvent.click(screen.getByText("Back"));

    expect(await screen.findByText("Need help with Dyad?")).toBeTruthy();
    fireEvent.click(screen.getByText("Report a Bug"));
    expect(
      ((await screen.findByLabelText(/What went wrong/)) as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });
});
