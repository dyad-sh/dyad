import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { HelpDialog } from "./HelpDialog";
import { helpDialogAtom } from "@/atoms/helpDialogAtom";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

const mocks = vi.hoisted(() => ({
  getSystemDebugInfo: vi.fn(),
  getSessionDebugBundle: vi.fn(),
  uploadToSignedUrl: vi.fn(),
  openExternalUrl: vi.fn(),
  takeScreenshot: vi.fn(),
  posthogCapture: vi.fn(),
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

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mocks.posthogCapture }),
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

vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));

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
      <HelpDialog />
    </>
  );
}

/** Walks the upload flow up to the screen that offers to create the issue. */
async function reachUploadCompleteScreen() {
  render(<OpenHelpDialog />);
  fireEvent.click(await screen.findByText("Upload Chat Session"));
  fireEvent.click(await screen.findByRole("button", { name: /^Upload$/ }));
  await screen.findByText("Upload Complete");
}

function bodyOfOpenedIssue(): string {
  const url = mocks.openExternalUrl.mock.calls.at(-1)?.[0] as string;
  return new URL(url).searchParams.get("body") ?? "";
}

describe("HelpDialog screenshot prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemDebugInfo.mockResolvedValue(debugInfo);
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

    expect(await screen.findByText("Take a screenshot?")).toBeTruthy();
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:shown",
      { source: "upload-session" },
    );
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("keeps the session ID after the prompt closes the help dialog", async () => {
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    fireEvent.click(await screen.findByText("Create issue without screenshot"));

    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    const body = bodyOfOpenedIssue();
    expect(body).toContain("Session ID: v2:abc");
    expect(body).toContain("Screenshot status: declined");
  });

  it("records a captured screenshot in the session issue", async () => {
    mocks.takeScreenshot.mockResolvedValue(undefined);
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    fireEvent.click(await screen.findByRole("button", { name: /recommended/ }));
    fireEvent.click(await screen.findByText("Create GitHub issue"));

    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    const body = bodyOfOpenedIssue();
    expect(body).toContain("Session ID: v2:abc");
    expect(body).toContain("Screenshot status: captured");
  });

  it("returns an uploaded session to the upload-complete screen when the prompt is dismissed", async () => {
    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    await screen.findByText("Take a screenshot?");

    fireEvent.click(screen.getByText("mock-dialog-dismiss"));

    // Back where they were, with the session ID they just uploaded intact and
    // one click from filing, rather than stranded with the upload orphaned.
    expect(await screen.findByText("Upload Complete")).toBeTruthy();
    expect(screen.getByText("v2:abc")).toBeTruthy();
    expect(screen.queryByText("Take a screenshot?")).toBeNull();
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();

    // And the recovered screen still files a complete issue.
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    fireEvent.click(await screen.findByText("Create issue without screenshot"));
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(bodyOfOpenedIssue()).toContain("Session ID: v2:abc");
  });

  it("keeps the prompt open showing progress while the report is prepared", async () => {
    let releaseDebugInfo = (_: unknown) => {};
    mocks.getSystemDebugInfo.mockReturnValue(
      new Promise((resolve) => {
        releaseDebugInfo = resolve;
      }),
    );

    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.click(
      await screen.findByText("File bug report without screenshot"),
    );

    // Gathering logs takes a moment; the reporter should see that it is
    // happening rather than a dialog that vanished and did nothing.
    expect(await screen.findByText("Preparing Report...")).toBeTruthy();
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();

    releaseDebugInfo(debugInfo);
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Take a screenshot?")).toBeNull(),
    );
  });

  it("does not let a report in flight be dismissed or interleaved with a capture", async () => {
    let releaseDebugInfo = (_: unknown) => {};
    mocks.getSystemDebugInfo.mockReturnValue(
      new Promise((resolve) => {
        releaseDebugInfo = resolve;
      }),
    );

    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    fireEvent.click(await screen.findByText("Create issue without screenshot"));
    await screen.findByText("Creating Issue...");

    // The issue is already on its way, so neither exit may take the reporter
    // somewhere the arriving report would contradict.
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));
    expect(screen.queryByText("Upload Complete")).toBeNull();
    expect(screen.getByText("Creating Issue...")).toBeTruthy();

    expect(
      screen
        .getByRole("button", { name: /recommended/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(mocks.takeScreenshot).not.toHaveBeenCalled();

    releaseDebugInfo(debugInfo);
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalledTimes(1));
    expect(bodyOfOpenedIssue()).toContain("Session ID: v2:abc");
  });

  it("cannot open a second prompt sealed shut by an earlier report in flight", async () => {
    let releaseDebugInfo = (_: unknown) => {};
    mocks.getSystemDebugInfo.mockReturnValue(
      new Promise((resolve) => {
        releaseDebugInfo = resolve;
      }),
    );
    mocks.takeScreenshot.mockRejectedValue(new Error("no window"));

    await reachUploadCompleteScreen();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    fireEvent.click(await screen.findByRole("button", { name: /recommended/ }));

    // Capture failed, so the report is in flight with no dialog on screen.
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("Take a screenshot?")).toBeNull(),
    );

    // Reopening help restores the upload-complete screen, but its button must
    // not mount a prompt whose every exit is held shut by the other report.
    fireEvent.click(screen.getByText("reopen-help"));
    expect(await screen.findByText("Upload Complete")).toBeTruthy();
    fireEvent.click(screen.getByText("Create GitHub Issue"));
    expect(screen.queryByText("Take a screenshot?")).toBeNull();

    releaseDebugInfo(debugInfo);
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalledTimes(1));
    expect(bodyOfOpenedIssue()).toContain("Screenshot status: capture-failed");
  });

  it("still offers the prompt on the bug report path", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));

    expect(await screen.findByText("Take a screenshot?")).toBeTruthy();
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:shown",
      { source: "report-bug" },
    );

    fireEvent.click(screen.getByText("File bug report without screenshot"));
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    expect(bodyOfOpenedIssue()).toContain("Screenshot status: declined");
  });
});
