import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { previewNativeViewAtom } from "@/atoms/previewAtoms";
import { selectedFileAtom, stagedDiffFileAtom } from "@/atoms/viewAtoms";
import { TestsPanel } from "./TestsPanel";

const mocks = vi.hoisted(() => ({
  listAppTests: vi.fn(),
  deleteAppTest: vi.fn(),
  runAppTests: vi.fn(),
  stopAppTests: vi.fn(),
  getTestScreenshot: vi.fn(),
  getAutomationStatus: vi.fn(),
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
  useSettings: () => ({ settings: mocks.settings, updateSettings: vi.fn() }),
}));

vi.mock("@/hooks/useRunApp", () => ({
  useRunApp: () => ({ runApp: vi.fn() }),
}));

// A running dev server, so the run controls aren't gated behind the
// "Start the app" banner.
vi.mock("@/hooks/useAppRun", () => ({
  useCurrentAppUrl: () => ({
    appUrl: "http://localhost:32100",
    appId: 1,
    originalUrl: "http://localhost:32100",
    mode: "host" as const,
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

  describe("run in preview", () => {
    const experimentOn = {
      enableTestRunInPreview: true,
    };

    it("stays hidden until the experiment is on", async () => {
      mocks.settings = {};
      renderPanel();

      expect(await screen.findByText("Run all")).toBeTruthy();
      expect(screen.queryByTestId("tests-run-in-preview-button")).toBeNull();
    });

    it("runs in the preview and brings the native view forward", async () => {
      mocks.settings = experimentOn;
      mocks.runAppTests.mockResolvedValue({ appId: 1, results: [] });
      const { store } = renderPanel();

      const button = await screen.findByTestId("tests-run-in-preview-button");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(store.get(previewNativeViewAtom)).toBe(true);
      expect(store.get(previewModeAtom)).toBe("preview");
      await waitFor(() => {
        expect(mocks.runAppTests).toHaveBeenCalledWith(
          expect.objectContaining({ appId: 1, preview: true, parallel: false }),
        );
      });
    });

    it("is disabled until Dyad has been restarted", async () => {
      mocks.settings = experimentOn;
      mocks.getAutomationStatus.mockResolvedValue({ cdpReady: false });
      renderPanel();

      const button = await screen.findByTestId("tests-run-in-preview-button");
      await waitFor(() => {
        expect(button.getAttribute("disabled")).not.toBeNull();
      });
      expect(button.getAttribute("title")).toContain("Restart Dyad");

      fireEvent.click(button);
      expect(mocks.runAppTests).not.toHaveBeenCalled();
    });

    it("leaves the ordinary Run all button alone", async () => {
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
});
