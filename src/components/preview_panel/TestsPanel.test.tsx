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
import {
  EMPTY_TEST_RUN_STATE,
  testRunStateByAppIdAtom,
  type TestRunState,
} from "@/atoms/testRuntimeAtoms";
import { selectedFileAtom, stagedDiffFileAtom } from "@/atoms/viewAtoms";
import { TestsPanel } from "./TestsPanel";

const mocks = vi.hoisted(() => ({
  listAppTests: vi.fn(),
  deleteAppTest: vi.fn(),
  runAppTests: vi.fn(),
  stopAppTests: vi.fn(),
  getTestScreenshot: vi.fn(),
  showError: vi.fn(),
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
  showError: mocks.showError,
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
  useChatMode: () => ({ selectedMode: "local-agent" }),
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

    it("shows parallel as unavailable in the preview but still sends the user's choice", async () => {
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
          // `parallel: true` on purpose. Preview runs are serialized in main,
          // which is the only side that knows whether the app's tsconfig let
          // this run into the preview at all. Sending `false` from here would
          // leave a run that fell back to an ordinary browser stuck serial for
          // no reason, despite Parallel being on.
          expect.objectContaining({ preview: true, parallel: true }),
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

    it("says why the run controls are dead somewhere the user can see", async () => {
      // Chromium suppresses pointer events on a disabled control, so the
      // `title` on the button never surfaces — the reason has to be rendered.
      mocks.settings = { ...experimentOn, testHeaded: true };
      mocks.getAutomationStatus.mockResolvedValue({ cdpReady: false });
      renderPanel();

      // The notice starts on the "checking" reason and settles on the restart
      // one once the port lookup returns its definitive answer.
      await waitFor(() => {
        expect(
          screen.getByTestId("tests-panel-run-blocked-notice").textContent,
        ).toContain("Restart Dyad");
      });
    });

    it("holds the run controls while the preview status is still unknown", async () => {
      // The status query polls for Chromium's port file for up to 5s. In that
      // window neither `cdpReady` nor a definitive `false` is available, so a
      // click used to be dispatched with `preview: false` and silently open a
      // separate browser — while the same click a moment later ran in-panel.
      mocks.settings = { ...experimentOn, testHeaded: true };
      let resolveStatus!: (value: { cdpReady: boolean }) => void;
      mocks.getAutomationStatus.mockReturnValue(
        new Promise<{ cdpReady: boolean }>((resolve) => {
          resolveStatus = resolve;
        }),
      );
      renderPanel();

      const button = await screen.findByText("Run all");
      await waitFor(() => {
        expect(button.getAttribute("disabled")).not.toBeNull();
      });
      expect(
        (await screen.findByTestId("tests-panel-run-blocked-notice"))
          .textContent,
      ).toContain("Checking");
      fireEvent.click(button);
      expect(mocks.runAppTests).not.toHaveBeenCalled();

      // Once the port answers, the run goes to the preview as asked.
      mocks.runAppTests.mockResolvedValue({ appId: 1, results: [] });
      await act(async () => {
        resolveStatus({ cdpReady: true });
      });
      await waitFor(() => {
        expect(button.getAttribute("disabled")).toBeNull();
      });
      await act(async () => {
        fireEvent.click(button);
      });
      await waitFor(() => {
        expect(mocks.runAppTests).toHaveBeenCalledWith(
          expect.objectContaining({ preview: true }),
        );
      });
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

    it("runs in a browser and says so when the port lookup fails outright", async () => {
      // A failed lookup is not "pending" — the query keeps polling, so it can
      // recover, and holding every run button hostage to a check that may
      // never answer is worse than running somewhere visible and explaining.
      mocks.settings = { ...experimentOn, testHeaded: true };
      mocks.getAutomationStatus.mockRejectedValue(new Error("no port"));
      mocks.runAppTests.mockResolvedValue({ appId: 1, results: [] });
      renderPanel();

      const button = await screen.findByText("Run all");
      await waitFor(() => {
        expect(
          screen.getByTestId("tests-panel-run-blocked-notice").textContent,
        ).toContain("separate browser window");
      });
      expect(button.getAttribute("disabled")).toBeNull();

      await act(async () => {
        fireEvent.click(button);
      });
      await waitFor(() => {
        expect(mocks.runAppTests).toHaveBeenCalledWith(
          expect.objectContaining({ preview: false }),
        );
      });
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

  describe("stopping a run", () => {
    /** Put the panel's app into `phase` as if a run had reached it. */
    function setPhase(
      store: ReturnType<typeof createStore>,
      state: Partial<TestRunState> & Pick<TestRunState, "phase">,
    ) {
      act(() => {
        store.set(
          testRunStateByAppIdAtom,
          new Map([
            [
              1,
              {
                ...EMPTY_TEST_RUN_STATE,
                runningFiles: [SPEC_FILE],
                startedAt: 1000,
                ...state,
              },
            ],
          ]),
        );
      });
    }

    it("latches the button before the main process answers", async () => {
      // The whole complaint this addresses is a Stop that looks ignored. The
      // main process is busy streaming runner output when the click lands, so
      // the round trip can miss a frame — the button cannot wait for it.
      const { store } = renderPanel();
      setPhase(store, { phase: "running" });
      let resolveStop: () => void = () => {};
      mocks.stopAppTests.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveStop = resolve;
        }),
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Stop running tests" }),
      );

      const button = screen.getByRole("button", { name: "Stopping tests" });
      expect(button.textContent).toContain("Stopping…");
      expect((button as HTMLButtonElement).disabled).toBe(true);
      resolveStop();
    });

    it("reports the kill, and refuses a second Stop", () => {
      const { store } = renderPanel();
      setPhase(store, { phase: "stopping" });

      const button = screen.getByRole("button", { name: "Stopping tests" });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByText(/Stopping the tests/)).toBeTruthy();

      fireEvent.click(button);
      expect(mocks.stopAppTests).not.toHaveBeenCalled();
    });

    it("unlatches and reports a failed stop so the user can retry", async () => {
      const { store } = renderPanel();
      setPhase(store, { phase: "running" });
      const error = new Error("stop failed");
      mocks.stopAppTests.mockRejectedValue(error);

      fireEvent.click(
        screen.getByRole("button", { name: "Stop running tests" }),
      );

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Stop running tests" }),
        ).toBeTruthy();
      });
      expect(mocks.showError).toHaveBeenCalledWith(error);
    });

    it("names the Neon teardown, which restarts the preview", () => {
      // This is the wait that can pass a minute (the branch delete retries with
      // backoff), and it visibly reloads the user's preview. Calling it
      // "Running…" — as the panel used to — reads as a hang.
      const { store } = renderPanel();
      setPhase(store, {
        phase: "cleaning-up",
        isolation: { mode: "neon-branch" },
      });

      expect(
        screen.getByText(/Restoring your database and preview/),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Restoring your app" }).textContent,
      ).toContain("Restoring…");
    });

    it("does not promise a database restore on the Supabase path", () => {
      // That teardown only deletes the temporary test user. It never swaps
      // `.env.local` and never restarts the app, so the Neon copy would lie.
      const { store } = renderPanel();
      setPhase(store, {
        phase: "cleaning-up",
        isolation: { mode: "supabase-test-user" },
      });

      expect(screen.getByText(/Cleaning up the test data/)).toBeTruthy();
      expect(screen.queryByText(/Restoring your database/)).toBeNull();
      expect(
        screen.getByRole("button", { name: "Cleaning up test data" })
          .textContent,
      ).toContain("Cleaning up…");
      expect(
        screen.queryByRole("button", { name: "Restoring your app" }),
      ).toBeNull();
    });

    it("does not carry a completed run's stop latch into the next run", () => {
      const { store } = renderPanel();
      setPhase(store, { phase: "running", startedAt: 1000 });
      mocks.stopAppTests.mockReturnValue(new Promise(() => {}));

      fireEvent.click(
        screen.getByRole("button", { name: "Stop running tests" }),
      );
      expect(
        screen.getByRole("button", { name: "Stopping tests" }),
      ).toBeTruthy();

      setPhase(store, { phase: "setup", startedAt: 2000 });

      expect(
        screen.getByRole("button", { name: "Stop running tests" }),
      ).toBeTruthy();
    });

    it("keeps per-test spinners while successful results await cleanup", async () => {
      const { store } = renderPanel();
      await screen.findByRole("button", {
        name: "Open in code editor: signup.spec.ts",
      });
      setPhase(store, { phase: "running" });
      expect(
        screen.getAllByRole("img", { name: "Running" }).length,
      ).toBeGreaterThan(0);
      expect(screen.queryAllByRole("status")).toEqual([]);

      setPhase(store, { phase: "cleaning-up", wasStopped: false });

      expect(screen.getAllByLabelText("Running").length).toBeGreaterThan(0);
    });

    it("clears the per-test spinners once a stopped run is gone", async () => {
      // Nothing can produce a result after the kill. A spinner that keeps
      // turning through the teardown claims otherwise.
      const { store } = renderPanel();
      // The rows carry the spinners, so wait for the spec list to land first.
      await screen.findByRole("button", {
        name: "Open in code editor: signup.spec.ts",
      });
      setPhase(store, { phase: "running" });
      expect(screen.getAllByLabelText("Running").length).toBeGreaterThan(0);

      setPhase(store, { phase: "cleaning-up", wasStopped: true });

      expect(screen.queryAllByLabelText("Running")).toEqual([]);
    });
  });
});
