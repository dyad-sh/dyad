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

function urlOfOpenedIssue(): URL {
  return new URL(mocks.openExternalUrl.mock.calls.at(-1)?.[0] as string);
}

function bodyOfOpenedIssue(): string {
  return urlOfOpenedIssue().searchParams.get("body") ?? "";
}

/** Help -> Report a Bug -> a filled-in form. */
async function openForm(description = "the preview goes blank") {
  render(<OpenHelpDialog />);
  fireEvent.click(await screen.findByText("Report a Bug"));
  const field = await screen.findByLabelText("What happened?");
  fireEvent.change(field, { target: { value: description } });
  return field as HTMLTextAreaElement;
}

const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: /Create GitHub issue/ }));

describe("HelpDialog report flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemDebugInfo.mockResolvedValue(debugInfo);
    mocks.getSessionDebugBundle.mockResolvedValue(bundle);
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
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

  it("goes straight from Help to the form", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));

    expect(await screen.findByLabelText("What happened?")).toBeTruthy();
    expect(posthogClient.capture).toHaveBeenCalledWith("issue-form:opened", {
      source: "report-bug",
    });
  });

  it("files the report with the description in the body", async () => {
    await openForm("the preview goes blank after a branch switch");
    submit();
    fireEvent.click(
      await screen.findByText("File bug report without screenshot"),
    );

    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
    const body = bodyOfOpenedIssue();
    expect(body).toContain("the preview goes blank after a branch switch");
    expect(body).toContain("Screenshot status: declined");
    expect(urlOfOpenedIssue().searchParams.get("labels")).toContain("bug");
  });

  it("will not submit without a description of some substance", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText("What happened?"), {
      target: { value: "asdf" },
    });

    submit();

    expect(screen.queryByText("Take a screenshot?")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "Please describe what happened",
    );
    expect(document.activeElement?.id).toBe("issue-description");
  });

  it("accepts a short but real description", async () => {
    await openForm("it crashed");
    submit();
    expect(await screen.findByText("Take a screenshot?")).toBeTruthy();
  });

  it("treats whitespace as empty and clears the message once filled", async () => {
    render(<OpenHelpDialog />);
    fireEvent.click(await screen.findByText("Report a Bug"));
    const field = await screen.findByLabelText("What happened?");
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
      ((await screen.findByLabelText("What happened?")) as HTMLTextAreaElement)
        .value,
    ).toBe("");
  });
});

describe("HelpDialog disclosures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSystemDebugInfo.mockResolvedValue(debugInfo);
    mocks.getSessionDebugBundle.mockResolvedValue(bundle);
    mocks.uploadToSignedUrl.mockResolvedValue(undefined);
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

  const fileIt = async () => {
    submit();
    fireEvent.click(
      await screen.findByText("File bug report without screenshot"),
    );
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
  };

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
    expect(body).toContain("## System Information\nNot included.");
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
    render(<OpenHelpDialog />);
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

  it("still files the report when the session upload fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await openForm("the preview goes blank");
    await fileIt();

    const body = bodyOfOpenedIssue();
    expect(body).toContain("the preview goes blank");
    expect(body).not.toContain("Session ID");
  });

  it("opens the form with the session ticked after a force-close", async () => {
    render(<OpenHelpDialog />);
    await screen.findByText("Need help with Dyad?");

    fireEvent.click(screen.getByText("force-close-report"));

    expect(await screen.findByLabelText("What happened?")).toBeTruthy();
    expect(
      (screen.getByLabelText("Chat session") as HTMLInputElement).checked,
    ).toBe(true);
  });
});
