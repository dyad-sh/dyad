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
  cancelUpload: vi.fn(),
  openExternalUrl: vi.fn(),
  takeScreenshot: vi.fn(),
  recopyScreenshot: vi.fn(),
  discardScreenshot: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  // Overridable per test; the default pair keeps the model lines out of the
  // body, which most of these tests rely on.
  settings: null as unknown,
  chatById: null as ((id: number | null) => unknown) | null,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    system: {
      getSystemDebugInfo: mocks.getSystemDebugInfo,
      openExternalUrl: mocks.openExternalUrl,
      uploadToSignedUrl: mocks.uploadToSignedUrl,
      cancelUpload: mocks.cancelUpload,
      takeScreenshot: mocks.takeScreenshot,
      recopyScreenshot: mocks.recopyScreenshot,
      discardScreenshot: mocks.discardScreenshot,
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

// Resolves against the real English bundle rather than echoing the key, so
// these tests assert on the copy a reporter sees and a mistyped key fails
// here instead of shipping.
vi.mock("react-i18next", async () => {
  const home = (await import("@/i18n/locales/en/home.json")).default;
  const common = (await import("@/i18n/locales/en/common.json")).default;
  const bundles: Record<string, unknown> = { home, common };
  const t = (key: string, vars?: Record<string, string>) => {
    // Matches the app's defaultNS, so an unprefixed key resolves the same
    // here as it would at runtime.
    const [ns, path] = key.includes(":") ? key.split(":") : ["common", key];
    const value = path
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)?.[part],
        bundles[ns],
      );
    if (typeof value !== "string") throw new Error(`Missing i18n key: ${key}`);
    // i18next substitutes {{name}}; without it a placeholder would render
    // literally here and the test would pass on copy no reporter ever sees.
    return value.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      vars && name in vars ? vars[name] : match,
    );
  };
  return { useTranslation: () => ({ t }) };
});

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));

vi.mock("@/hooks/useUserBudgetInfo", () => ({
  useUserBudgetInfo: () => ({ userBudget: { redactedUserId: "user-abc" } }),
}));

// Both are react-query backed and only feed the "Selected Model"/"Effort Level"
// diagnostic lines, which these tests do not assert on.
vi.mock("@/hooks/useChatMode", () => ({
  useChatMode: (id: number | null) => ({
    chat: mocks.chatById ? mocks.chatById(id) : null,
  }),
}));

vi.mock("@/hooks/useLanguageModelsByProviders", () => ({
  useLanguageModelsByProviders: () => ({ data: undefined }),
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
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
      {/* Stands in for the reporter moving to a different chat. */}
      <button onClick={() => setSelectedChatId(2)}>other-chat</button>
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

const addScreenshot = async () => {
  fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
  return screen.findByAltText("Screenshot copied to your clipboard");
};

const fileIt = async () => {
  submit();
  await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings = null;
  mocks.chatById = null;
  mocks.getSystemDebugInfo.mockResolvedValue(debugInfo);
  mocks.getSessionDebugBundle.mockResolvedValue(bundle);
  mocks.uploadToSignedUrl.mockResolvedValue(undefined);
  mocks.cancelUpload.mockResolvedValue({ cancelled: true });
  mocks.recopyScreenshot.mockResolvedValue({ copied: true });
  mocks.discardScreenshot.mockResolvedValue({ discarded: true });
  mocks.takeScreenshot.mockResolvedValue({
    dataUrl: "data:image/png;base64,AAAA",
    captureId: "capture-1",
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

  it("re-reads diagnostics for a draft the reporter comes back to", async () => {
    await openForm("half-written report");
    await screen.findByText(/Dyad Version: 1\.2\.3/);

    // The reporter leaves the form up, goes back to the app and makes the bug
    // happen again. The logs worth having are the ones written since.
    mocks.getSystemDebugInfo.mockResolvedValue({
      ...debugInfo,
      dyadVersion: "4.5.6",
    });
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));
    fireEvent.click(screen.getByText("reopen-help"));

    expect(await screen.findByText(/Dyad Version: 4\.5\.6/)).toBeTruthy();
    await fileIt();
    expect(bodyOfOpenedIssue()).toContain("4.5.6");
  });

  it("reads diagnostics for a report started while the form is already up", async () => {
    await openForm("half-written report");
    await screen.findByText(/Dyad Version: 1\.2\.3/);
    mocks.getSystemDebugInfo.mockResolvedValue({
      ...debugInfo,
      dyadVersion: "4.5.6",
    });

    // A crash report replaces the draft in place, so the screen never changes
    // and only the report itself can ask for the new read.
    fireEvent.click(screen.getByText("force-close-report"));
    fireEvent.change(await screen.findByLabelText(/What happened/), {
      target: { value: "it crashed while I was working" },
    });

    expect(await screen.findByText(/Dyad Version: 4\.5\.6/)).toBeTruthy();
    await fileIt();
    const body = bodyOfOpenedIssue();
    expect(body).toContain("4.5.6");
    expect(body).not.toContain("Could not be collected on this machine.");
  });

  it("reports the model for the chat the report is about", async () => {
    mocks.settings = {
      selectedModel: { provider: "openai", name: "fallback-model" },
    };
    mocks.chatById = (id) => ({
      modelSelection: {
        provider: "openai",
        name: id === 1 ? "chat-a-model" : "chat-b-model",
        effortLevel: "high",
      },
    });

    // The draft is pinned to chat 1; the reporter then goes to look at another
    // chat before coming back to submit it.
    await openForm("started in the first chat");
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));
    fireEvent.click(screen.getByText("other-chat"));
    fireEvent.click(screen.getByText("reopen-help"));
    await fileIt();

    // The uploaded session is chat 1's, so the model has to be too.
    const body = bodyOfOpenedIssue();
    expect(body).toContain("chat-a-model");
    expect(body).not.toContain("chat-b-model");
  });

  it("keeps the last diagnostics while a reopened draft re-reads", async () => {
    await openForm("half-written report");
    await screen.findByText(/Dyad Version: 1\.2\.3/);

    // The re-read is still in flight, so what the reporter last saw is what
    // goes: filing straight away must not report them as unavailable.
    mocks.getSystemDebugInfo.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));
    fireEvent.click(screen.getByText("reopen-help"));
    await screen.findByText(/Dyad Version: 1\.2\.3/);
    await fileIt();

    const body = bodyOfOpenedIssue();
    expect(body).toContain("1.2.3");
    expect(body).not.toContain("Could not be collected on this machine.");
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
      await screen.findByRole("checkbox", {
        name: "Basic system information and logs",
      }),
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
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Chat session" }),
    );
    await fileIt();

    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
    expect(bodyOfOpenedIssue()).not.toContain("Session ID");
  });

  it("offers no session when there is no chat open", async () => {
    renderHelp();
    fireEvent.click(screen.getByText("clear-chat"));
    fireEvent.click(await screen.findByText("Report a Bug"));

    expect(
      screen
        .getByRole("checkbox", { name: "Chat session" })
        .hasAttribute("data-disabled"),
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
    const box = screen.getByRole("checkbox", { name: "Chat session" });
    expect(box.hasAttribute("data-disabled")).toBe(true);

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

    // Backing out of a filing that is taking too long has to work, and has to
    // leave the reporter able to write a new report.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/What happened/), {
      target: { value: "the second problem" },
    });

    await act(async () => {
      release(undefined);
    });

    // Back cancels: the abandoned report does not open a browser on top of
    // the one the reporter is now writing, and does not clear it either.
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("the second problem")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Create GitHub issue/ }),
    ).toBeTruthy();
  });

  it("does not warn about a report the reporter backed out of", async () => {
    let fail = (_: unknown) => {};
    mocks.uploadToSignedUrl.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );

    await openForm("a slow one");
    submit();
    await screen.findByRole("button", { name: /Preparing your report/ });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await act(async () => {
      fail(new Error("offline"));
    });

    // Every one of these toasts says the report went without something. For a
    // report that never went at all, that is just noise about nothing.
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("stops sending the session when the reporter backs out", async () => {
    mocks.uploadToSignedUrl.mockReturnValue(new Promise(() => {}));

    await openForm("a slow one");
    submit();
    await waitFor(() => expect(mocks.uploadToSignedUrl).toHaveBeenCalled());
    const { uploadId } = mocks.uploadToSignedUrl.mock.calls.at(-1)![0];
    expect(uploadId).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    // The session is the reporter's private data. Backing out has to stop it
    // going, not just stop the issue being opened afterwards.
    await waitFor(() =>
      expect(mocks.cancelUpload).toHaveBeenCalledWith({ uploadId }),
    );
  });

  it("does not send the session when the reporter backs out before the PUT", async () => {
    let releaseUrl = (_: unknown) => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          releaseUrl = () =>
            resolve({
              ok: true,
              json: async () => ({
                uploadUrl: "https://upload.test/signed",
                filename: "abc.json",
              }),
            });
        }),
      ),
    );

    await openForm("a slow one");
    submit();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    // Nothing private has left yet: the signed-URL request carries only the
    // content type, so backing out here must stop before the PUT.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await act(async () => {
      releaseUrl(undefined);
    });

    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("cancels the report when the dialog is dismissed mid-filing", async () => {
    mocks.uploadToSignedUrl.mockReturnValue(new Promise(() => {}));

    await openForm("a slow one");
    submit();
    await waitFor(() => expect(mocks.uploadToSignedUrl).toHaveBeenCalled());
    const { uploadId } = mocks.uploadToSignedUrl.mock.calls.at(-1)![0];

    // Escape and the close button are the same intent as Back here, and were
    // the exit that did not cancel anything.
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));

    await waitFor(() =>
      expect(mocks.cancelUpload).toHaveBeenCalledWith({ uploadId }),
    );
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("keeps the screenshot of a draft that survives a dismissal", async () => {
    mocks.uploadToSignedUrl.mockReturnValue(new Promise(() => {}));

    await openForm("a slow one");
    await addScreenshot();
    submit();
    await waitFor(() => expect(mocks.uploadToSignedUrl).toHaveBeenCalled());

    fireEvent.click(screen.getByText("mock-dialog-dismiss"));

    // The form still shows the preview when they come back, so the image has
    // to still exist for them to paste.
    expect(mocks.discardScreenshot).not.toHaveBeenCalled();
  });

  it("does not open GitHub for a report dismissed mid-filing", async () => {
    let release = (_: unknown) => {};
    mocks.uploadToSignedUrl.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm("a slow one");
    submit();
    await waitFor(() => expect(mocks.uploadToSignedUrl).toHaveBeenCalled());
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));

    await act(async () => {
      release(undefined);
    });

    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("uploads the session the disclosure was reading, not a second copy", async () => {
    let release = (_: unknown) => {};
    mocks.getSessionDebugBundle.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm();
    const summaries = screen.getAllByText("Show what will be sent");
    fireEvent.click(summaries[summaries.length - 1]);
    await waitFor(() =>
      expect(mocks.getSessionDebugBundle).toHaveBeenCalledTimes(1),
    );

    // Submitting before the read lands must join it, not start another: two
    // reads mean the reporter reviews one snapshot and sends a different one.
    submit();
    await act(async () => {
      release(bundle);
    });
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());

    expect(mocks.getSessionDebugBundle).toHaveBeenCalledTimes(1);
  });

  it("tries the session again after a failed preview read", async () => {
    mocks.getSessionDebugBundle.mockRejectedValueOnce(new Error("locked"));

    await openForm();
    const summaries = screen.getAllByText("Show what will be sent");
    fireEvent.click(summaries[summaries.length - 1]);
    await waitFor(() =>
      expect(mocks.getSessionDebugBundle).toHaveBeenCalledTimes(1),
    );

    // Remembering the failure would cost the maintainer the session for good,
    // and show the reporter a second error for the same fault.
    await fileIt();
    expect(mocks.getSessionDebugBundle).toHaveBeenCalledTimes(2);
    expect(bodyOfOpenedIssue()).toContain("Session ID");
  });

  it("shows the session it is uploading when expanded after submit", async () => {
    let release = (_: unknown) => {};
    mocks.getSessionDebugBundle.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm();
    // The disclosure starts collapsed, so submitting first is the common path.
    submit();
    await waitFor(() =>
      expect(mocks.getSessionDebugBundle).toHaveBeenCalledTimes(1),
    );

    const summaries = screen.getAllByText("Show what will be sent");
    fireEvent.click(summaries[summaries.length - 1]);
    await act(async () => {
      release(bundle);
    });
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());

    // Expanding after submit must join the upload's read, not start a rival
    // one that shows the reporter a different snapshot than the one sent.
    expect(mocks.getSessionDebugBundle).toHaveBeenCalledTimes(1);
  });

  it("leaves a way out when filing stalls", async () => {
    mocks.uploadToSignedUrl.mockReturnValue(new Promise(() => {}));

    await openForm("it hangs on submit");
    submit();
    await screen.findByRole("button", { name: /Preparing your report/ });

    // Neither fetch has a timeout, and a broken network is exactly the
    // situation a bug reporter is in.
    const back = screen.getByRole("button", {
      name: "Back",
    }) as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    fireEvent.click(back);
    expect(await screen.findByText("Need help with Dyad?")).toBeTruthy();
  });

  it("locks everything the filed report was built from", async () => {
    mocks.uploadToSignedUrl.mockReturnValue(new Promise(() => {}));

    await openForm();
    await addScreenshot();
    submit();
    await screen.findByRole("button", { name: /Preparing your report/ });

    // Changing any of these would be accepted by the UI and ignored by the
    // report that is already on its way.
    expect(
      (screen.getByLabelText(/What happened/) as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(
      screen
        .getByRole("checkbox", { name: "Chat session" })
        .hasAttribute("data-disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("checkbox", { name: "Basic system information and logs" })
        .hasAttribute("data-disabled"),
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /Remove/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /Retake/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
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

  it("announces that the report is being prepared", async () => {
    let release = (_: unknown) => {};
    mocks.uploadToSignedUrl.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm();
    submit();

    // Nothing else tells a screen reader the button press was heard.
    const live = await screen.findAllByRole("status");
    expect(
      live.some((node) => node.textContent?.includes("Preparing your report")),
    ).toBe(true);

    // Let the filing finish inside this test, or it lands in the next one.
    await act(async () => {
      release(undefined);
    });
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());
  });

  it("sends the diagnostics the reporter reviewed, not a later read", async () => {
    // Only the first read matches what the disclosure showed.
    mocks.getSystemDebugInfo.mockImplementation(async () =>
      mocks.getSystemDebugInfo.mock.calls.length === 1
        ? debugInfo
        : { ...debugInfo, dyadVersion: "9.9.9" },
    );
    await openForm();
    await screen.findByText(/Dyad Version: 1\.2\.3/);
    await fileIt();

    const body = bodyOfOpenedIssue();
    expect(body).toContain("1.2.3");
    expect(body).not.toContain("9.9.9");
  });

  it("files anyway when the diagnostics read never comes back", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.getSystemDebugInfo.mockReturnValue(new Promise(() => {}));

      await openForm();
      submit();
      // A wedged shell command must not strand the reporter on a spinner.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());

      expect(bodyOfOpenedIssue()).toContain(
        "Could not be collected on this machine.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the gate against the report that was blocked", async () => {
    renderHelp();
    await screen.findByText("Need help with Dyad?");
    fireEvent.click(screen.getByText("force-close-report"));
    await screen.findByLabelText(/What happened/);
    submit();

    // Both halves of the blocked/opened ratio have to name the same source,
    // or the crash cohort reads as never hitting the gate.
    await waitFor(() =>
      expect(posthogClient.capture).toHaveBeenCalledWith("issue-form:blocked", {
        source: "force-close",
      }),
    );
  });

  it("waits for diagnostics that are still loading rather than dropping them", async () => {
    let release = (_: unknown) => {};
    mocks.getSystemDebugInfo.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm();
    // Submitting while the disclosure still says "Loading diagnostics...".
    submit();
    await act(async () => {
      release(debugInfo);
    });
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalled());

    // The machine was perfectly able to answer; it just had not yet.
    const body = bodyOfOpenedIssue();
    expect(body).toContain("1.2.3");
    expect(body).not.toContain("Could not be collected on this machine.");
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
      screen
        .getByRole("checkbox", { name: "Chat session" })
        .hasAttribute("data-checked"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
    await screen.findByAltText("Screenshot copied to your clipboard");

    // The reporter agreed to send the session; it must not quietly withdraw.
    const box = screen.getByRole("checkbox", { name: "Chat session" });
    expect(box.hasAttribute("data-disabled")).toBe(false);
    expect(box.hasAttribute("data-checked")).toBe(true);
  });

  it("counts a crash-opened form, and says it came from the crash", async () => {
    renderHelp();
    await screen.findByText("Need help with Dyad?");
    fireEvent.click(screen.getByText("force-close-report"));
    await screen.findByLabelText(/What happened/);

    // Counted like any other report, but tellable apart from one: whether the
    // crash flow works is a question the Help-menu numbers cannot answer.
    expect(posthogClient.capture).toHaveBeenCalledWith("issue-form:opened", {
      source: "force-close",
    });
  });

  it("carries the crash source on the report's screenshot events too", async () => {
    renderHelp();
    await screen.findByText("Need help with Dyad?");
    fireEvent.click(screen.getByText("force-close-report"));
    await screen.findByLabelText(/What happened/);
    await addScreenshot();

    expect(posthogClient.capture).toHaveBeenCalledWith(
      "screenshot-prompt:captured",
      { source: "force-close" },
    );
  });

  it("says a Help-menu report came from the Help menu", async () => {
    await openForm();
    await addScreenshot();

    expect(posthogClient.capture).toHaveBeenCalledWith("issue-form:opened", {
      source: "report-bug",
    });
    expect(posthogClient.capture).toHaveBeenCalledWith(
      "screenshot-prompt:captured",
      { source: "report-bug" },
    );
  });

  it("opens the form with the session ticked after a force-close", async () => {
    renderHelp();
    await screen.findByText("Need help with Dyad?");

    fireEvent.click(screen.getByText("force-close-report"));

    expect(await screen.findByLabelText(/What happened/)).toBeTruthy();
    expect(
      screen
        .getByRole("checkbox", { name: "Chat session" })
        .hasAttribute("data-checked"),
    ).toBe(true);
  });
});

describe("HelpDialog screenshot", () => {
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

    release({ dataUrl: "data:image/png;base64,AAAA", captureId: "capture-1" });

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

    release({ dataUrl: "data:image/png;base64,AAAA", captureId: "capture-1" });

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

  it("files nothing for a report the reporter backed out of", async () => {
    let release = (_: unknown) => {};
    mocks.uploadToSignedUrl.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm("the first problem");
    await addScreenshot();
    submit();
    await screen.findByRole("button", { name: /Preparing your report/ });

    // Back is live during a slow filing, so the reporter can give up on it
    // and start writing something else.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/What happened/), {
      target: { value: "the second problem" },
    });
    await addScreenshot();

    await act(async () => {
      release(undefined);
    });

    // Both are visible outside the dialog and would arrive with nothing on
    // screen to explain them, so neither may happen for a report that was
    // backed out of.
    expect(mocks.recopyScreenshot).not.toHaveBeenCalled();
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("does not open the browser when the reporter backs out mid-clipboard", async () => {
    let release = (_: unknown) => {};
    mocks.recopyScreenshot.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm();
    await addScreenshot();
    submit();
    await waitFor(() => expect(mocks.recopyScreenshot).toHaveBeenCalled());

    // Restoring the clipboard is an IPC round trip, so Back can land inside it.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await act(async () => {
      release({ copied: true });
    });

    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  });

  it("restores the capture the reporter kept, not the one they replaced", async () => {
    mocks.takeScreenshot
      .mockResolvedValueOnce({
        dataUrl: "data:image/png;base64,AAAA",
        captureId: "capture-first",
      })
      .mockResolvedValueOnce({
        dataUrl: "data:image/png;base64,BBBB",
        captureId: "capture-second",
      });

    await openForm();
    await addScreenshot();
    fireEvent.click(screen.getByRole("button", { name: /Retake/ }));
    // The first capture's preview is still on screen, so waiting for the alt
    // text alone would race the retake.
    await waitFor(() =>
      expect(
        (
          screen.getByAltText(
            "Screenshot copied to your clipboard",
          ) as HTMLImageElement
        ).src,
      ).toContain("BBBB"),
    );
    await fileIt();

    // The reporter is told to paste, so the clipboard has to hold the image
    // they actually kept.
    expect(mocks.recopyScreenshot).toHaveBeenCalledWith({
      captureId: "capture-second",
    });
    expect(mocks.recopyScreenshot).not.toHaveBeenCalledWith({
      captureId: "capture-first",
    });
  });

  it("does not claim a screenshot the clipboard could not take back", async () => {
    mocks.recopyScreenshot.mockResolvedValue({ copied: false });
    await openForm();
    await addScreenshot();
    await fileIt();

    // There is nothing for the reporter to paste, so the issue must not tell
    // a maintainer to expect an image.
    const body = bodyOfOpenedIssue();
    expect(body).toContain("Screenshot status: capture-failed");
    expect(body).not.toContain("Screenshot status: captured");
  });

  it("lets the next report take a screenshot after one never lands", async () => {
    mocks.takeScreenshot.mockReturnValue(new Promise(() => {}));

    await openForm("first report");
    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());

    // A crash starts a fresh report without passing through Back.
    fireEvent.click(screen.getByText("force-close-report"));

    // Nothing is coming back to clear the flag, so the new report has to.
    const button = (await screen.findByRole("button", {
      name: /Add a screenshot/,
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("keeps the button disabled when an older capture lands", async () => {
    let release = (_: unknown) => {};
    mocks.takeScreenshot
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      )
      .mockReturnValueOnce(new Promise(() => {}));

    await openForm("first report");
    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());

    fireEvent.click(screen.getByText("reopen-help"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.click(
      await screen.findByRole("button", { name: /Add a screenshot/ }),
    );
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalledTimes(2));

    await act(async () => {
      release({ dataUrl: "data:image/png;base64,AAAA", captureId: "old" });
    });

    // The first report's capture must not report the second one as finished.
    fireEvent.click(screen.getByText("reopen-help"));
    expect(
      await screen.findByRole("button", { name: /Taking screenshot/ }),
    ).toBeTruthy();
  });

  it("drops an abandoned capture instead of leaving it in memory", async () => {
    await openForm();
    await addScreenshot();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    // Nothing will ever paste it, and it is a full-resolution picture of the
    // window sitting in the main process.
    await waitFor(() =>
      expect(mocks.discardScreenshot).toHaveBeenCalledWith({
        captureId: "capture-1",
      }),
    );
  });

  it("drops a capture that lands after its report is gone", async () => {
    let release = (_: unknown) => {};
    mocks.takeScreenshot.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await openForm();
    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());

    fireEvent.click(screen.getByText("reopen-help"));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await act(async () => {
      release({ dataUrl: "data:image/png;base64,AAAA", captureId: "late" });
    });

    // Main stored it before the guard could run, so dropping it is the only
    // thing left that can.
    await waitFor(() =>
      expect(mocks.discardScreenshot).toHaveBeenCalledWith({
        captureId: "late",
      }),
    );
  });

  it("drops the capture a retake replaced", async () => {
    mocks.takeScreenshot
      .mockResolvedValueOnce({
        dataUrl: "data:image/png;base64,AAAA",
        captureId: "capture-first",
      })
      .mockResolvedValueOnce({
        dataUrl: "data:image/png;base64,BBBB",
        captureId: "capture-second",
      });

    await openForm();
    await addScreenshot();
    fireEvent.click(screen.getByRole("button", { name: /Retake/ }));
    await waitFor(() =>
      expect(
        (
          screen.getByAltText(
            "Screenshot copied to your clipboard",
          ) as HTMLImageElement
        ).src,
      ).toContain("BBBB"),
    );

    // Retake is one click and entirely ordinary, so the replaced image must
    // not sit in the main process waiting to be evicted.
    await waitFor(() =>
      expect(mocks.discardScreenshot).toHaveBeenCalledWith({
        captureId: "capture-first",
      }),
    );
  });

  it("drops a capture when the dialog is unmounted", async () => {
    const view = renderHelp();
    fireEvent.click(await screen.findByText("Report a Bug"));
    fireEvent.change(await screen.findByLabelText(/What happened/), {
      target: { value: "unmount me" },
    });
    await addScreenshot();

    view.unmount();

    await waitFor(() =>
      expect(mocks.discardScreenshot).toHaveBeenCalledWith({
        captureId: "capture-1",
      }),
    );
  });

  it("shows the paste shortcut as keys, in one sentence", async () => {
    await openForm();
    await addScreenshot();

    const hint = screen
      .getByAltText("Screenshot copied to your clipboard")
      .parentElement!.querySelector("p.text-xs")!;

    // The sentence has to read as one sentence, with the keys marked up.
    expect(hint.textContent).toBe(
      "Copied to your clipboard. Press Cmd/Ctrl + V in the GitHub issue to attach it.",
    );
    expect(
      Array.from(hint.querySelectorAll("kbd")).map((k) => k.textContent),
    ).toEqual(["Cmd", "Ctrl", "V"]);
  });

  it("still shows why a capture failed", async () => {
    mocks.takeScreenshot.mockRejectedValue(
      new Error("No focused window to capture"),
    );

    await openForm();
    fireEvent.click(screen.getByRole("button", { name: /Add a screenshot/ }));

    // The generic line is translated and the OS reason is not, so they render
    // separately -- but the reason still has to reach the reporter.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not take a screenshot.");
    expect(alert.textContent).toContain("You can still send the report");
    expect(alert.textContent).toContain("No focused window to capture");
  });

  it("keeps the earlier screenshot when a retake fails", async () => {
    mocks.takeScreenshot
      .mockResolvedValueOnce({
        dataUrl: "data:image/png;base64,AAAA",
        captureId: "capture-first",
      })
      .mockRejectedValueOnce(new Error("No focused window to capture"));

    await openForm();
    await addScreenshot();
    fireEvent.click(screen.getByRole("button", { name: /Retake/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalledTimes(2));

    // The first image is still on the clipboard and still in main, so losing
    // it to a failed retake would throw away something that works.
    expect(
      await screen.findByAltText("Screenshot copied to your clipboard"),
    ).toBeTruthy();
    await fileIt();
    expect(bodyOfOpenedIssue()).toContain("Screenshot status: captured");
    expect(mocks.recopyScreenshot).toHaveBeenCalledWith({
      captureId: "capture-first",
    });
  });

  it("drops a capture the reporter removed", async () => {
    await openForm();
    await addScreenshot();

    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));

    await waitFor(() =>
      expect(mocks.discardScreenshot).toHaveBeenCalledWith({
        captureId: "capture-1",
      }),
    );
  });

  it("does not discard a capture it just put back on the clipboard", async () => {
    await openForm();
    await addScreenshot();
    await fileIt();

    // The restore already dropped it in main; asking again is pointless work.
    expect(mocks.discardScreenshot).not.toHaveBeenCalled();
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
