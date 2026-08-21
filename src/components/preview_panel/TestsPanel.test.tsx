import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { recordingStartRequestAtom } from "@/atoms/recorderAtoms";
import { previewNativeViewAppIdAtom } from "@/atoms/previewAtoms";
import { selectedFileAtom, stagedDiffFileAtom } from "@/atoms/viewAtoms";
import { TestsPanel } from "./TestsPanel";

const mocks = vi.hoisted(() => ({
  listAppTests: vi.fn(),
  deleteAppTest: vi.fn(),
  runAppTests: vi.fn(),
  stopAppTests: vi.fn(),
  getTestScreenshot: vi.fn(),
  /** Null stands in for a dev server that isn't up. */
  appUrl: "http://localhost:32100" as string | null,
  previewUrl: "http://localhost:32100/" as string | null,
  previewUrlSource: "dyad" as "none" | "dyad" | "app",
  getAutomationStatus: vi.fn(),
  updateSettings: vi.fn(),
  settings: {} as Record<string, unknown>,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    tests: {
      listAppTests: mocks.listAppTests,
      deleteAppTest: mocks.deleteAppTest,
      runAppTests: mocks.runAppTests,
      stopAppTests: mocks.stopAppTests,
      getTestScreenshot: mocks.getTestScreenshot,
    },
    previewView: {
      getAutomationStatus: mocks.getAutomationStatus,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: { id: 1, testingEnabled: true } }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("@/hooks/useRunApp", () => ({
  useRunApp: () => ({ runApp: vi.fn() }),
}));

// A running dev server by default, so the run controls aren't gated behind the
// "Start the app" banner. Recording is gated on it too, so it's configurable.
vi.mock("@/hooks/useAppRun", () => ({
  useCurrentAppUrl: () => ({
    appUrl: mocks.appUrl,
    appId: 1,
    originalUrl: mocks.appUrl,
    mode: "host" as const,
  }),
}));

vi.mock("@/preview_iframe/usePreviewIframe", () => ({
  usePreviewIframeController: () => ({
    state: {
      history: mocks.previewUrl ? [mocks.previewUrl] : [],
      position: 0,
      currentUrl: mocks.previewUrl,
      currentUrlSource: mocks.previewUrlSource,
    },
  }),
}));

vi.mock("@/hooks/useSetTestingEnabled", () => ({
  useSetTestingEnabled: () => ({
    setTestingEnabled: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ streamMessage: vi.fn(), isStreaming: false }),
}));

vi.mock("@/chat_stream/ChatStreamProvider", () => ({
  useStreamFinished: vi.fn(),
}));

vi.mock("@/hooks/useChatMode", () => ({
  useChatMode: () => ({ effectiveMode: "local-agent" }),
}));

vi.mock("./MigrateTestsBanner", () => ({
  MigrateTestsBanner: () => null,
}));

const SPEC_FILE = "e2e-tests/signup.spec.ts";

function renderPanel() {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  const utils = render(<TestsPanel />, { wrapper });
  return { store, ...utils };
}

describe("TestsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appUrl = "http://localhost:32100";
    mocks.previewUrl = "http://localhost:32100/";
    mocks.previewUrlSource = "dyad";
    mocks.listAppTests.mockResolvedValue({
      specs: [
        {
          file: SPEC_FILE,
          tests: [
            { title: "signs up", line: 4 },
            { title: "rejects a bad password", line: 12 },
          ],
        },
      ],
    });
    mocks.deleteAppTest.mockResolvedValue({
      file: SPEC_FILE,
      committed: true,
      uncommittedReason: null,
    });
    mocks.settings = {};
    mocks.getAutomationStatus.mockResolvedValue({ cdpReady: true });
  });

  describe("headed runs in preview", () => {
    const experimentOn = {
      enableTestRunInPreview: true,
    };

    it("runs headed mode in the preview and brings the native view forward", async () => {
      mocks.settings = { ...experimentOn, testHeaded: true };
      mocks.runAppTests.mockResolvedValue({ appId: 1, results: [] });
      const { store } = renderPanel();

      const button = await screen.findByText("Run all");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(store.get(previewNativeViewAppIdAtom)).toBe(1);
      expect(store.get(previewModeAtom)).toBe("preview");
      await waitFor(() => {
        expect(mocks.runAppTests).toHaveBeenCalledWith(
          expect.objectContaining({ appId: 1, preview: true, parallel: false }),
        );
      });
    });

    it("disables parallel runs in the preview WebContentsView", async () => {
      mocks.settings = {
        ...experimentOn,
        testHeaded: true,
        testParallel: true,
      };
      mocks.runAppTests.mockResolvedValue({ appId: 1, results: [] });
      renderPanel();

      fireEvent.click(
        await screen.findByRole("button", { name: "Open test options" }),
      );
      const parallelToggle = await screen.findByRole("switch", {
        name: "Switch to parallel mode",
      });
      expect(parallelToggle.hasAttribute("data-disabled")).toBe(true);
      expect(
        screen.getByText("Unavailable while tests run in the preview panel."),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      const button = await screen.findByText("Run all");
      await act(async () => {
        fireEvent.click(button);
      });

      await waitFor(() => {
        expect(mocks.runAppTests).toHaveBeenCalledWith(
          expect.objectContaining({ preview: true, parallel: false }),
        );
      });
    });

    it("says the debugging port is open for the whole session", async () => {
      // Enabled once and forgotten is the realistic case, and the exposure
      // lasts the session rather than the run — so it belongs where the
      // feature is used, not only in the Settings switch.
      mocks.settings = { ...experimentOn, testHeaded: true };
      renderPanel();

      expect(
        await screen.findByTestId("tests-panel-debug-port-notice"),
      ).toBeTruthy();
    });

    it("keeps the port notice off when the experiment is off", async () => {
      mocks.settings = { testHeaded: true };
      renderPanel();

      await screen.findByText("Run all");
      expect(screen.queryByTestId("tests-panel-debug-port-notice")).toBeNull();
    });

    it("disables a headed run until Dyad has been restarted", async () => {
      mocks.settings = { ...experimentOn, testHeaded: true };
      mocks.getAutomationStatus.mockResolvedValue({ cdpReady: false });
      renderPanel();

      const button = await screen.findByText("Run all");
      await waitFor(() => {
        expect(button.getAttribute("disabled")).not.toBeNull();
      });
      expect(button.getAttribute("title")).toContain("Restart Dyad");

      fireEvent.click(button);
      expect(mocks.runAppTests).not.toHaveBeenCalled();
    });

    it("disables the per-file and per-test runs too", async () => {
      // Not just the Run-all button: a per-file run reaches the same code
      // path, so it would tear down the iframe preview for a native view and
      // then dead-end on the same "restart Dyad" error.
      mocks.settings = { ...experimentOn, testHeaded: true };
      mocks.getAutomationStatus.mockResolvedValue({ cdpReady: false });
      renderPanel();

      const fileRun = await screen.findByRole("button", {
        name: `Run all tests in: signup.spec.ts`,
      });
      await waitFor(() => {
        expect(fileRun.getAttribute("disabled")).not.toBeNull();
      });
      expect(fileRun.getAttribute("title")).toContain("Restart Dyad");

      fireEvent.click(fileRun);
      expect(mocks.runAppTests).not.toHaveBeenCalled();
    });

    it("leaves headless runs out of the preview", async () => {
      mocks.settings = experimentOn;
      mocks.runAppTests.mockResolvedValue({ appId: 1, results: [] });
      renderPanel();

      const runAll = await screen.findByText("Run all");
      await act(async () => {
        fireEvent.click(runAll);
      });

      await waitFor(() => {
        expect(mocks.runAppTests).toHaveBeenCalledWith(
          expect.objectContaining({ preview: false }),
        );
      });
    });
  });

  describe("slow motion", () => {
    it("defaults to full speed and persists the choice", async () => {
      renderPanel();

      // Persisted rather than local state, so the agent's run_tests tool runs
      // at the pace the user picked here too.
      fireEvent.click(
        await screen.findByRole("button", { name: "Open test options" }),
      );
      const toggle = await screen.findByRole("switch", {
        name: "Switch to slow motion",
      });
      fireEvent.click(toggle);

      expect(mocks.updateSettings).toHaveBeenCalledWith({ testSlowMo: true });
    });

    it("sends the chosen pace with the run", async () => {
      mocks.settings = { testSlowMo: true };
      mocks.runAppTests.mockResolvedValue({ appId: 1, results: [] });
      renderPanel();

      fireEvent.click(
        await screen.findByRole("button", { name: "Open test options" }),
      );
      expect(
        screen.getByRole("switch", { name: "Switch to normal speed" }),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      const runAll = await screen.findByText("Run all");
      await act(async () => {
        fireEvent.click(runAll);
      });

      await waitFor(() => {
        expect(mocks.runAppTests).toHaveBeenCalledWith(
          expect.objectContaining({ slowMo: true }),
        );
      });
    });
  });

  it("keeps only the primary actions in the header", async () => {
    renderPanel();

    await screen.findByRole("button", { name: "Run all tests" });
    const header = await screen.findByTestId("tests-panel-header");
    const headerButtons = within(header).getAllByRole("button");

    expect(headerButtons).toHaveLength(3);
    expect(
      headerButtons.map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Open test options",
      "Record a test in the preview",
      "Run all tests",
    ]);
    expect(
      within(header).getByRole("button", {
        name: "Record a test in the preview",
      }),
    ).toBeTruthy();
    expect(
      within(header).getByRole("button", { name: "Open test options" }),
    ).toBeTruthy();
    expect(
      within(header).getByRole("button", { name: "Run all tests" }),
    ).toBeTruthy();
  });

  it("moves secondary controls into the options dialog", async () => {
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", { name: "Open test options" }),
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Test options")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Switch to parallel mode" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Switch to headed mode" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Switch to slow motion" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Disable testing for this app" }),
    ).toBeTruthy();
  });

  it("opens a spec file in the code editor", async () => {
    const { store } = renderPanel();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open in code editor: signup.spec.ts",
      }),
    );

    expect(store.get(previewModeAtom)).toBe("code");
    expect(store.get(selectedFileAtom)).toEqual({
      path: SPEC_FILE,
      line: null,
    });
  });

  it("clears a staged diff so the spec is what actually shows up", async () => {
    const { store } = renderPanel();
    // A diff opened earlier from the commit menu: CodeView renders it in
    // preference to the selected file, so opening a spec has to clear it.
    store.set(stagedDiffFileAtom, "src/main.ts");

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open in code editor: signup.spec.ts",
      }),
    );

    expect(store.get(stagedDiffFileAtom)).toBeNull();
    expect(store.get(previewModeAtom)).toBe("code");
  });

  it("opens an individual test at its own line", async () => {
    const { store } = renderPanel();

    // Expand the file so its test cases (and their actions) are rendered.
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Toggle tests in signup.spec.ts",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open test in code editor: rejects a bad password",
      }),
    );

    expect(store.get(previewModeAtom)).toBe("code");
    expect(store.get(selectedFileAtom)).toEqual({ path: SPEC_FILE, line: 12 });
  });

  it("deletes a spec file only after the deletion is confirmed", async () => {
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Delete test file: signup.spec.ts",
      }),
    );

    // The confirmation names the file and the tests that go with it; nothing
    // is deleted until the user confirms.
    expect(await screen.findByTestId("delete-test-file-dialog")).not.toBeNull();
    expect(screen.getByText("Delete signup.spec.ts?")).not.toBeNull();
    expect(screen.getByText(/the 2 tests in it/)).not.toBeNull();
    expect(mocks.deleteAppTest).not.toHaveBeenCalled();

    // Once the spec is gone, the refetched list is empty.
    mocks.listAppTests.mockResolvedValue({ specs: [] });
    fireEvent.click(screen.getByTestId("confirm-delete-test-file"));

    await waitFor(() => {
      expect(mocks.deleteAppTest).toHaveBeenCalledWith({
        appId: 1,
        testFile: SPEC_FILE,
      });
    });
    expect(await screen.findByText("No tests yet")).not.toBeNull();
  });

  it("drops the pending confirmation when the app changes", async () => {
    const { store } = renderPanel();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Delete test file: signup.spec.ts",
      }),
    );
    expect(await screen.findByTestId("delete-test-file-dialog")).not.toBeNull();

    // The panel stays mounted across app switches. The confirmation named a
    // spec in the app the user just left, so it must not carry over and delete
    // a same-named spec from the app that's now selected.
    act(() => {
      store.set(selectedAppIdAtom, 2);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("delete-test-file-dialog")).toBeNull();
    });
    expect(mocks.deleteAppTest).not.toHaveBeenCalled();
  });

  it("keeps the spec listed when cancelling the confirmation", async () => {
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Delete test file: signup.spec.ts",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByTestId("delete-test-file-dialog")).toBeNull();
    });
    expect(mocks.deleteAppTest).not.toHaveBeenCalled();
    expect(screen.getByText("signup.spec.ts")).not.toBeNull();
  });

  // Recording runs in the preview, but this panel is where users look for it.
  it("hands a record request to the preview recorder", () => {
    mocks.previewUrl = "http://localhost:32100/settings?tab=profile#billing";
    const { store } = renderPanel();
    store.set(previewModeAtom, "tests");

    fireEvent.click(screen.getByTestId("tests-record-button"));

    expect(store.get(recordingStartRequestAtom)?.appId).toBe(1);
    expect(store.get(recordingStartRequestAtom)?.startPath).toBe(
      "/settings?tab=profile#billing",
    );
    // The recorder only exists in the preview, so the panel switches to it.
    expect(store.get(previewModeAtom)).toBe("preview");
  });

  it("sends no start path for a route the app navigated to itself", () => {
    // A redirect or an in-app link is not a starting point the user chose.
    // Recording it as one makes the generated spec `goto` straight to the
    // destination, skipping the navigation that may be the thing under test.
    // The recorder puts the preview back on the app root instead, so the
    // session still starts where the spec's `page.goto("/")` replays from.
    mocks.previewUrl = "http://localhost:32100/login?next=%2Fsettings";
    mocks.previewUrlSource = "app";
    const { store } = renderPanel();
    store.set(previewModeAtom, "tests");

    fireEvent.click(screen.getByTestId("tests-record-button"));

    expect(store.get(recordingStartRequestAtom)?.appId).toBe(1);
    expect(store.get(recordingStartRequestAtom)?.startPath).toBeUndefined();
  });

  it("disables recording until the app is running", () => {
    // Nothing to record against: the session arms the injected client inside a
    // live preview.
    mocks.appUrl = null;

    renderPanel();

    expect(
      (screen.getByTestId("tests-record-button") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
