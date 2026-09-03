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
  updateSettings: vi.fn(),
  app: { id: 1, testingEnabled: true } as Record<string, unknown>,
  settings: {} as Record<string, unknown>,
  settingsLoading: false,
  refreshSettings: vi.fn(),
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
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: mocks.app }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
    loading: mocks.settingsLoading,
    refreshSettings: mocks.refreshSettings,
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
    mocks.app = { id: 1, testingEnabled: true };
    mocks.settings = {};
    mocks.settingsLoading = false;
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

    it("starts a preview run immediately", async () => {
      mocks.settings = { ...experimentOn, testHeaded: true };
      mocks.runAppTests.mockResolvedValue({ appId: 1, results: [] });
      renderPanel();

      const button = await screen.findByText("Run all");
      expect(button.getAttribute("disabled")).toBeNull();
      await act(async () => {
        fireEvent.click(button);
      });
      await waitFor(() => {
        expect(mocks.runAppTests).toHaveBeenCalledWith(
          expect.objectContaining({ preview: true }),
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

  it("runs sandboxed tests without the preview being up", async () => {
    // A sandboxed run serves its own copy of the app on its own port. Requiring
    // the user's preview would block the whole point of the feature — and would
    // contradict the panel's own "your preview keeps running" disclosure.
    mocks.appUrl = null;

    renderPanel();

    await screen.findByText("signup.spec.ts");
    expect(screen.queryByText("Start the app to run tests.")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Run all tests",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("still requires the preview when the run is not sandboxed", async () => {
    // The fallback path runs Playwright against the user's preview, so the
    // gate is still correct there.
    mocks.appUrl = null;
    mocks.settings = { disableSandboxedE2eTests: true };

    renderPanel();

    expect(await screen.findByText("Start the app to run tests.")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Run all tests",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("explains nothing, and allows nothing, while settings are still loading", async () => {
    // Two different defaults on purpose. No banner: `usesSandboxedE2eTests`
    // answers false for absent settings, so an amber refusal would flash on
    // every mount for a state that may not apply at all. But Run stays
    // disabled — leaving it clickable in a state the panel can't evaluate
    // sends the user into the main-process refusal, which is exactly what
    // disclosing it beforehand is for.
    mocks.appUrl = null;
    mocks.settings = undefined as unknown as Record<string, unknown>;
    mocks.settingsLoading = true;

    renderPanel();

    expect(
      (
        (await screen.findByRole("button", {
          name: "Run all tests",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByText("Start the app to run tests.")).toBeNull();
    expect(screen.queryByText(/Dyad won't run Neon tests/)).toBeNull();
    expect(screen.queryByText(/couldn't load your settings/)).toBeNull();
  });

  it("says why Run is disabled when settings fail to load", async () => {
    // The other half of the tri-state. Silence is right for the brief load
    // above, but a settled failure leaves every run control greyed out for as
    // long as the panel is open — and without this, nothing on screen says so.
    mocks.appUrl = null;
    mocks.settings = undefined as unknown as Record<string, unknown>;
    mocks.settingsLoading = false;

    renderPanel();

    expect(await screen.findByText(/couldn't load your settings/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Run all tests",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refreshSettings).toHaveBeenCalled();
  });

  describe("sandbox disclosure", () => {
    it("tells Neon users their preview keeps its real database", async () => {
      // The pre-sandbox copy promised a double preview restart. Nothing
      // restarts any more, so that disclosure would now be a lie.
      mocks.app = { id: 1, testingEnabled: true, neonProjectId: "neon-proj" };
      renderPanel();

      expect(
        await screen.findByText(/Your preview keeps running against your real/),
      ).toBeTruthy();
      expect(screen.queryByText(/restart the preview/i)).toBeNull();
    });

    it("drops the sandbox disclosure when the sandbox is turned off", async () => {
      mocks.app = { id: 1, testingEnabled: true, neonProjectId: "neon-proj" };
      mocks.settings = { disableSandboxedE2eTests: true };
      renderPanel();

      await screen.findByText("signup.spec.ts");
      expect(screen.queryByText(/Your preview keeps running/)).toBeNull();
    });

    it("says why the run is refused when the sandbox is turned off", async () => {
      // The main process refuses every Neon run without a sandbox rather than
      // touching the real database. Leaving Run enabled would hide that behind
      // a click; starting the preview would not help either.
      mocks.app = { id: 1, testingEnabled: true, neonProjectId: "neon-proj" };
      mocks.settings = { disableSandboxedE2eTests: true };
      renderPanel();

      expect(
        await screen.findByText(/isolated test servers are turned off/i),
      ).toBeTruthy();
      expect(screen.queryByText("Start the app to run tests.")).toBeNull();
      expect(
        (
          screen.getByRole("button", {
            name: "Run all tests",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });

    it("names the runtime when that is why there is no sandbox", async () => {
      // The Settings hint doesn't cover this case at all, so the panel is the
      // only place the user can find out why the app can't run its tests.
      mocks.app = { id: 1, testingEnabled: true, neonProjectId: "neon-proj" };
      mocks.settings = { runtimeMode2: "docker" };
      renderPanel();

      expect(
        await screen.findByText(/aren't available in docker runtime yet/i),
      ).toBeTruthy();
    });

    it("does not refuse an app that also has Supabase", async () => {
      // The handler picks Supabase first and isolates it with a throwaway test
      // user, which needs no sandbox — so a row carrying both provider ids runs
      // fine. Refusing it here would disable Run for a run the backend accepts.
      mocks.app = {
        id: 1,
        testingEnabled: true,
        neonProjectId: "neon-proj",
        supabaseProjectId: "sb-proj",
      };
      mocks.settings = { disableSandboxedE2eTests: true };
      renderPanel();

      await screen.findByText("signup.spec.ts");
      expect(screen.queryByText(/Dyad won't run Neon tests/)).toBeNull();
      expect(
        (
          screen.getByRole("button", {
            name: "Run all tests",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });

    it("leaves a non-Neon app's run alone when the sandbox is off", async () => {
      // Nothing to refuse: without a Neon project the fallback path runs
      // against the preview, which is exactly what the dev-server gate covers.
      mocks.app = { id: 1, testingEnabled: true };
      mocks.settings = { disableSandboxedE2eTests: true };
      renderPanel();

      await screen.findByText("signup.spec.ts");
      expect(screen.queryByText(/Dyad won't run Neon tests/)).toBeNull();
      expect(
        (
          screen.getByRole("button", {
            name: "Run all tests",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });

    it("promises no sandbox while settings are still loading", async () => {
      // The Run gate treats loading as "sandbox available" so it doesn't refuse
      // the run; this banner has to key off the same guard, or the panel
      // briefly promises sandboxing to a user who has it turned off.
      mocks.app = { id: 1, testingEnabled: true, neonProjectId: "neon-proj" };
      mocks.settings = undefined as unknown as Record<string, unknown>;
      renderPanel();

      await screen.findByText("signup.spec.ts");
      expect(screen.queryByText(/Your preview keeps running/)).toBeNull();
    });
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

    it("names the Neon teardown without promising a restore", () => {
      // This is the wait that can pass a minute (the branch delete retries with
      // backoff). Calling it "Running…" — as the panel used to — reads as a
      // hang, but the run had its own sandbox and its own server, so nothing
      // of the user's is being put back either.
      const { store } = renderPanel();
      setPhase(store, {
        phase: "cleaning-up",
        isolation: { mode: "neon-branch" },
      });

      expect(
        screen.getByText(/Removing the temporary test database/),
      ).toBeTruthy();
      expect(screen.queryByText(/Restoring/i)).toBeNull();
      expect(
        screen.getByRole("button", {
          name: "Removing the temporary test database",
        }).textContent,
      ).toContain("Cleaning up…");
    });

    it("names the sandbox cleanup on the Supabase path", () => {
      // That teardown only deletes the temporary test user and the run's
      // sandbox copy. It never swaps `.env.local` and never restarts the app.
      const { store } = renderPanel();
      setPhase(store, {
        phase: "cleaning-up",
        isolation: { mode: "supabase-test-user" },
        sandboxed: true,
      });

      expect(screen.getByText(/Cleaning up the test sandbox/)).toBeTruthy();
      expect(screen.queryByText(/Restoring/i)).toBeNull();
      expect(
        screen.getByRole("button", { name: "Cleaning up test data" })
          .textContent,
      ).toContain("Cleaning up…");
    });

    it("claims no sandbox when the run never took one", () => {
      // The fallback path (docker/cloud runtime, or the opt-out) creates no
      // workspace, so naming one would be the same inaccurate cleanup copy the
      // Neon "restoring your preview" wording was.
      const { store } = renderPanel();
      setPhase(store, {
        phase: "cleaning-up",
        isolation: { mode: "supabase-test-user" },
        sandboxed: false,
      });

      expect(screen.getByText(/Cleaning up the test data/)).toBeTruthy();
      expect(screen.queryByText(/test sandbox/)).toBeNull();
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
