import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { appUrlByAppIdAtom } from "@/atoms/previewRuntimeAtoms";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { TestsPanel } from "./TestsPanel";

const mocks = vi.hoisted(() => ({
  listAppTests: vi.fn(),
  deleteAppTest: vi.fn(),
  runAppTests: vi.fn(),
  stopAppTests: vi.fn(),
  getTestScreenshot: vi.fn(),
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
  showError: vi.fn(),
  showInfo: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: { id: 1, testingEnabled: true } }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: {}, updateSettings: vi.fn() }),
}));

vi.mock("@/hooks/useRunApp", () => ({
  useRunApp: () => ({ runApp: vi.fn() }),
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
  // A running dev server, so the run controls aren't gated behind the
  // "Start the app" banner.
  store.set(
    appUrlByAppIdAtom,
    new Map([
      [
        1,
        {
          appUrl: "http://localhost:32100",
          appId: 1,
          originalUrl: "http://localhost:32100",
          mode: "host" as const,
        },
      ],
    ]),
  );
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
    mocks.deleteAppTest.mockResolvedValue({ file: SPEC_FILE });
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
