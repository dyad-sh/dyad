import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useTestRunEvents } from "@/hooks/useTestRunEvents";
import { queryKeys } from "@/lib/queryKeys";
import type {
  TestRunQueueSnapshot,
  TestsRunStatePayload,
} from "@/ipc/types/tests";
import { DRAINED_BATCH_LINGER_MS, TestRunQueueCard } from "./TestRunQueueCard";

type QueueEvent = TestRunQueueSnapshot & { appId: number };
const mocks = vi.hoisted(() => ({
  getRunQueue: vi.fn(),
  queueListeners: new Set<(event: QueueEvent) => void>(),
  runListeners: new Set<(event: TestsRunStatePayload) => void>(),
  openTests: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    tests: {
      getRunQueue: mocks.getRunQueue,
      getActiveRun: async () => null,
      listAppTests: async () => ({ specs: [] }),
    },
    events: {
      tests: {
        onOutput: () => () => {},
        onQueueState: (listener: (event: QueueEvent) => void) => {
          mocks.queueListeners.add(listener);
          return () => mocks.queueListeners.delete(listener);
        },
        onRunState: (listener: (event: TestsRunStatePayload) => void) => {
          mocks.runListeners.add(listener);
          return () => mocks.runListeners.delete(listener);
        },
      },
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "testRunQueue.title": "Test queue",
        "testRunQueue.openTests": "Open Tests",
        "testRunQueue.allTests": "All tests",
        "testRunQueue.currentChat": "Current chat",
        "testRunQueue.openChat": "Open chat",
        "testRunQueue.testsPanel": "Tests panel",
        "testRunQueue.queued": "Queued",
        "testRunQueue.running": "Running",
        "testRunQueue.stopping": "Stopping",
        "testRunQueue.passed": "Passed",
        "testRunQueue.failed": "Failed",
        "testRunQueue.inconclusive": "Inconclusive",
      })[key] ?? key,
  }),
}));

const empty = { activeRun: null, queuedRuns: [] };
const first = {
  runId: 1,
  source: "agent" as const,
  chatId: 11,
  testFile: "e2e-tests/login.spec.ts",
};
const second = {
  runId: 2,
  source: "panel" as const,
  testFile: "e2e-tests/checkout.spec.ts",
};

beforeEach(() => {
  mocks.queueListeners.clear();
  mocks.runListeners.clear();
  mocks.openTests.mockReset();
  mocks.navigate.mockReset();
  mocks.getRunQueue.mockReset().mockResolvedValue(empty);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Lets tests jump past the linger while RTL polling still advances in real time. */
function installLingerClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
}

function publishQueue(queue: TestRunQueueSnapshot, appId = 1) {
  for (const listener of mocks.queueListeners) listener({ appId, ...queue });
}

function publishRun(event: TestsRunStatePayload) {
  for (const listener of mocks.runListeners) listener(event);
}

function LifecycleObserver() {
  useTestRunEvents();
  return null;
}

function setup() {
  const store = createStore();
  store.set(selectedAppIdAtom, 1);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Harness({
    appId = 1,
    chatId = 11,
    visible = true,
  }: {
    appId?: number | null;
    chatId?: number;
    visible?: boolean;
  }) {
    return (
      <QueryClientProvider client={client}>
        <Provider store={store}>
          <LifecycleObserver />
          {visible && (
            <TestRunQueueCard
              appId={appId}
              chatId={chatId}
              onOpenTests={mocks.openTests}
            />
          )}
        </Provider>
      </QueryClientProvider>
    );
  }
  return { Harness, client, store };
}

function row(label: string) {
  return screen.getByText(label).closest("li")!;
}

/** A batch drained while watched stays readable for the linger, then hides. */
async function expectLingerThenDismiss(label: string, status: string) {
  await act(() => vi.advanceTimersByTimeAsync(DRAINED_BATCH_LINGER_MS / 2));
  expect(within(row(label)).getByText(status)).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(DRAINED_BATCH_LINGER_MS));
  expect(screen.queryByRole("region", { name: "Test queue" })).toBeNull();
}

it("shows live queued and running requests without mounting the Tests panel", async () => {
  installLingerClock();
  mocks.getRunQueue.mockResolvedValue({
    activeRun: { ...first, stopping: false },
    queuedRuns: [second],
  });
  const { Harness } = setup();
  render(<Harness />);
  await screen.findByText(first.testFile);
  const originalOrder = [row(first.testFile), row(second.testFile)];
  expect(screen.getAllByRole("listitem")).toEqual(originalOrder);
  expect(within(row(first.testFile)).getByText("Running")).toBeTruthy();
  expect(row(first.testFile).className).toContain("text-gray-500");
  expect(row(first.testFile).querySelector(".animate-spin")).not.toBeNull();
  expect(within(row(second.testFile)).getByText("Queued")).toBeTruthy();
  expect(row(second.testFile).className).toContain("text-yellow-700");
  expect(row(second.testFile).querySelector(".fill-current")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Tests" }));
  expect(mocks.openTests).toHaveBeenCalledOnce();

  act(() => {
    publishRun({
      appId: 1,
      ...first,
      state: "finished",
      results: [{ file: first.testFile, status: "passed" }],
    });
    publishQueue({ activeRun: { ...second, stopping: false }, queuedRuns: [] });
  });
  await waitFor(() =>
    expect(within(row(first.testFile)).getByText("Passed")).toBeTruthy(),
  );
  expect(row(first.testFile).className).toContain("text-green-600");
  expect(within(row(second.testFile)).getByText("Running")).toBeTruthy();
  expect(screen.getAllByRole("listitem")).toEqual(originalOrder);

  act(() => {
    publishRun({
      appId: 1,
      ...second,
      state: "finished",
      results: [{ file: second.testFile, status: "failed" }],
    });
  });
  await waitFor(() =>
    expect(within(row(second.testFile)).getByText("Failed")).toBeTruthy(),
  );
  expect(row(second.testFile).className).toContain("text-red-600");
  expect(screen.getAllByRole("listitem")).toEqual(originalOrder);
  expect(screen.queryByText("Running")).toBeNull();
  act(() => publishQueue(empty));
  await expectLingerThenDismiss(second.testFile, "Failed");
});

it("identifies each run's chat, opens other chats, and retains attribution after completion and chat switches", async () => {
  const otherChatRun = {
    ...first,
    runId: 3,
    chatId: 22,
    testFile: "e2e-tests/profile.spec.ts",
  };
  mocks.getRunQueue.mockResolvedValue({
    activeRun: { ...first, stopping: false },
    queuedRuns: [second, otherChatRun],
  });
  const { Harness, store } = setup();
  const view = render(<Harness />);
  await screen.findByText(first.testFile);

  expect(within(row(first.testFile)).getByText("Current chat")).toBeTruthy();
  expect(within(row(first.testFile)).queryByRole("button")).toBeNull();
  expect(within(row(second.testFile)).getByText("Tests panel")).toBeTruthy();
  expect(within(row(second.testFile)).queryByRole("button")).toBeNull();
  fireEvent.click(
    within(row(otherChatRun.testFile)).getByRole("button", {
      name: "Open chat",
    }),
  );
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: "/chat",
    search: { id: otherChatRun.chatId, appId: 1 },
  });
  expect(store.get(selectedChatIdAtom)).toBe(otherChatRun.chatId);
  expect(store.get(selectedAppIdAtom)).toBe(1);

  act(() => {
    publishRun({
      appId: 1,
      ...first,
      state: "finished",
      results: [{ file: first.testFile, status: "passed" }],
    });
    publishQueue({
      activeRun: { ...second, stopping: false },
      queuedRuns: [otherChatRun],
    });
  });
  await waitFor(() =>
    expect(within(row(first.testFile)).getByText("Passed")).toBeTruthy(),
  );
  expect(within(row(first.testFile)).getByText("Current chat")).toBeTruthy();

  view.rerender(<Harness chatId={otherChatRun.chatId} />);
  expect(
    within(row(otherChatRun.testFile)).getByText("Current chat"),
  ).toBeTruthy();
  expect(within(row(otherChatRun.testFile)).queryByRole("button")).toBeNull();
  fireEvent.click(
    within(row(first.testFile)).getByRole("button", { name: "Open chat" }),
  );
  expect(mocks.navigate).toHaveBeenLastCalledWith({
    to: "/chat",
    search: { id: first.chatId, appId: 1 },
  });
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});

it("does not invent a chat destination for runs without chat metadata", async () => {
  const { chatId: _chatId, ...unattributed } = first;
  mocks.getRunQueue.mockResolvedValue({
    activeRun: { ...unattributed, stopping: false },
    queuedRuns: [],
  });
  const { Harness } = setup();
  render(<Harness />);
  await screen.findByText(first.testFile);
  expect(within(row(first.testFile)).queryByRole("button")).toBeNull();
  expect(screen.queryByText("Current chat")).toBeNull();
  expect(screen.queryByText("Tests panel")).toBeNull();
});

it.each([
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["inconclusive", "Inconclusive"],
] as const)(
  "automatically dismisses %s results after the queue drains, stays hidden on remount, and reappears for new runs",
  async (status, label) => {
    installLingerClock();
    mocks.getRunQueue.mockResolvedValue({
      activeRun: { ...first, stopping: false },
      queuedRuns: [],
    });
    const { Harness } = setup();
    const view = render(<Harness />);
    await screen.findByText("Running");
    act(() =>
      publishRun({
        appId: 1,
        ...first,
        state: "finished",
        results: [{ file: first.testFile, status }],
      }),
    );
    await waitFor(() => expect(screen.queryByText("Running")).toBeNull());
    // A terminal result can arrive before the queue's settled snapshot.
    expect(screen.getByRole("region", { name: "Test queue" })).toBeTruthy();
    mocks.getRunQueue.mockResolvedValue(empty);
    act(() => publishQueue(empty));
    await expectLingerThenDismiss(first.testFile, label);

    view.rerender(<Harness visible={false} />);
    view.rerender(<Harness />);
    await waitFor(() => expect(mocks.getRunQueue).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("region", { name: "Test queue" })).toBeNull();

    act(() =>
      publishQueue({
        activeRun: { ...second, stopping: false },
        queuedRuns: [],
      }),
    );
    await screen.findByText(second.testFile);
    expect(screen.queryByText(first.testFile)).toBeNull();

    act(() => {
      publishRun({
        appId: 1,
        ...second,
        state: "finished",
        results: [{ file: second.testFile, status: "passed" }],
      });
      publishQueue(empty);
    });
    await expectLingerThenDismiss(second.testFile, "Passed");
  },
);

it("keeps lingering outcomes in the batch when another run is queued before dismissal", async () => {
  installLingerClock();
  mocks.getRunQueue.mockResolvedValue({
    activeRun: { ...first, stopping: false },
    queuedRuns: [],
  });
  const { Harness } = setup();
  render(<Harness />);
  await screen.findByText("Running");
  act(() => {
    publishRun({
      appId: 1,
      ...first,
      state: "finished",
      results: [{ file: first.testFile, status: "passed" }],
    });
    publishQueue(empty);
  });
  await act(() => vi.advanceTimersByTimeAsync(DRAINED_BATCH_LINGER_MS / 2));
  act(() =>
    publishQueue({ activeRun: { ...second, stopping: false }, queuedRuns: [] }),
  );
  await act(() => vi.advanceTimersByTimeAsync(DRAINED_BATCH_LINGER_MS * 2));
  expect(within(row(first.testFile)).getByText("Passed")).toBeTruthy();
  expect(within(row(second.testFile)).getByText("Running")).toBeTruthy();

  act(() => {
    publishRun({
      appId: 1,
      ...second,
      state: "finished",
      results: [{ file: second.testFile, status: "failed" }],
    });
    publishQueue(empty);
  });
  await expectLingerThenDismiss(first.testFile, "Passed");
});

it("automatically dismisses settled apps without hiding another app's ongoing batch", async () => {
  mocks.getRunQueue.mockImplementation(async ({ appId }) =>
    appId === 1
      ? empty
      : { activeRun: { ...second, stopping: false }, queuedRuns: [] },
  );
  const { Harness } = setup();
  const view = render(<Harness />);
  act(() => {
    for (const appId of [1, 2]) {
      publishRun({
        appId,
        ...first,
        state: "finished",
        results: [{ file: first.testFile, status: "passed" }],
      });
    }
  });
  await waitFor(() =>
    expect(mocks.getRunQueue).toHaveBeenCalledWith({ appId: 1 }),
  );
  expect(screen.queryByRole("region", { name: "Test queue" })).toBeNull();
  view.rerender(<Harness appId={2} />);
  await screen.findByText("Passed");
  expect(screen.getByText("Running")).toBeTruthy();
  view.rerender(<Harness />);
  expect(screen.queryByRole("region", { name: "Test queue" })).toBeNull();
});

it("retains results received while the chat is closed and keeps apps isolated", async () => {
  mocks.getRunQueue.mockImplementation(async ({ appId }) =>
    appId === 1
      ? { activeRun: { ...second, stopping: false }, queuedRuns: [] }
      : empty,
  );
  const { Harness } = setup();
  const view = render(<Harness visible={false} />);
  act(() =>
    publishRun({
      appId: 1,
      ...first,
      state: "finished",
      results: [{ file: first.testFile, status: "passed" }],
    }),
  );
  view.rerender(<Harness />);
  await screen.findByText("Passed");
  view.rerender(<Harness appId={2} />);
  await waitFor(() =>
    expect(mocks.getRunQueue).toHaveBeenCalledWith({ appId: 2 }),
  );
  expect(screen.queryByRole("region", { name: "Test queue" })).toBeNull();
  act(() =>
    publishQueue(
      { activeRun: { ...second, stopping: false }, queuedRuns: [] },
      1,
    ),
  );
  expect(screen.queryByText(second.testFile)).toBeNull();
  view.rerender(<Harness />);
  await screen.findByText("Passed");
});

it("keeps a batch that finished with chat closed hidden when chat reopens", async () => {
  const { Harness, client } = setup();
  const view = render(<Harness visible={false} />);
  act(() =>
    publishRun({
      appId: 1,
      ...first,
      state: "finished",
      results: [{ file: first.testFile, status: "passed" }],
    }),
  );
  view.rerender(<Harness />);
  await waitFor(() =>
    expect(client.getQueryData(queryKeys.tests.queue({ appId: 1 }))).toEqual(
      empty,
    ),
  );
  expect(screen.queryByRole("region", { name: "Test queue" })).toBeNull();
  act(() =>
    publishQueue({ activeRun: { ...second, stopping: false }, queuedRuns: [] }),
  );
  await screen.findByText(second.testFile);
  expect(screen.queryByText(first.testFile)).toBeNull();
});

it("waits for a fresh queue snapshot before dismissing cached results on remount", async () => {
  mocks.getRunQueue.mockResolvedValue({
    activeRun: { ...second, stopping: false },
    queuedRuns: [],
  });
  const { Harness, client } = setup();
  const view = render(<Harness visible={false} />);
  act(() => {
    client.setQueryData(queryKeys.tests.queue({ appId: 1 }), empty);
    publishRun({
      appId: 1,
      ...first,
      state: "finished",
      results: [{ file: first.testFile, status: "passed" }],
    });
  });
  view.rerender(<Harness />);
  await screen.findByText("Running");
  expect(screen.getByText("Passed")).toBeTruthy();
});

it("keeps repeated runs separate and does not flash a completed run back to running", async () => {
  mocks.getRunQueue.mockResolvedValue({
    activeRun: { ...first, stopping: false },
    queuedRuns: [{ ...first, runId: 2 }],
  });
  const { Harness } = setup();
  render(<Harness />);
  await screen.findByText("Queued");
  act(() =>
    publishRun({
      appId: 1,
      ...first,
      state: "finished",
      results: [{ file: first.testFile, status: "passed" }],
    }),
  );
  await screen.findByText("Passed");
  expect(screen.queryByText("Running")).toBeNull();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  act(() =>
    publishQueue({
      activeRun: { ...first, runId: 2, stopping: false },
      queuedRuns: [],
    }),
  );
  await screen.findByText("Running");
  expect(screen.getByText("Passed")).toBeTruthy();
});

it("removes cancelled queued requests without inventing a passing result", async () => {
  mocks.getRunQueue.mockResolvedValue({
    activeRun: { ...first, stopping: false },
    queuedRuns: [second],
  });
  const { Harness } = setup();
  render(<Harness />);
  await screen.findByText("Queued");
  act(() =>
    publishQueue({ activeRun: { ...first, stopping: true }, queuedRuns: [] }),
  );
  await screen.findByText("Stopping");
  expect(screen.getByRole("region", { name: "Test queue" })).toBeTruthy();
  expect(screen.queryByText(second.testFile)).toBeNull();
  expect(screen.queryByText("Passed")).toBeNull();
});

it.each([
  { results: [], expected: "Inconclusive" },
  {
    results: [
      { file: first.testFile, status: "passed" as const, incomplete: true },
    ],
    expected: "Inconclusive",
  },
  {
    results: [{ file: first.testFile, status: "inconclusive" as const }],
    expected: "Inconclusive",
  },
  {
    results: [],
    infraError: { message: "Test run stopped." },
    expected: "Inconclusive",
  },
  {
    results: [{ file: first.testFile, status: "passed" as const }],
    infraError: { message: "Cleanup failed" },
    expected: "Inconclusive",
  },
  {
    results: [{ file: first.testFile, status: "failed" as const }],
    infraError: { message: "Cleanup failed" },
    expected: "Failed",
  },
])(
  "reports incomplete/empty/failed runs honestly: $expected",
  async ({ expected, ...result }) => {
    mocks.getRunQueue.mockResolvedValue({
      activeRun: { ...first, stopping: false },
      queuedRuns: [],
    });
    const { Harness } = setup();
    render(<Harness />);
    await screen.findByText("Running");
    act(() => publishRun({ appId: 1, ...first, state: "finished", ...result }));
    await screen.findByText(expected);
    expect(screen.queryByText("Passed")).toBeNull();
  },
);

it("labels whole-suite, batch, single-case and grep selections", async () => {
  mocks.getRunQueue.mockResolvedValue({
    activeRun: { runId: 1, source: "panel", stopping: false },
    queuedRuns: [
      { ...first, runId: 2, testLine: 12 },
      { ...first, runId: 3, grep: "signs in" },
      {
        runId: 4,
        source: "agent",
        testFiles: [first.testFile, second.testFile],
      },
    ],
  });
  const { Harness } = setup();
  render(<Harness />);
  await screen.findByText("All tests");
  expect(screen.getByText(`${first.testFile}:12`)).toBeTruthy();
  expect(screen.getByText(`${first.testFile} · signs in`)).toBeTruthy();
  expect(
    screen.getByText(`${first.testFile}, ${second.testFile}`),
  ).toBeTruthy();
});

it("stays hidden when there is no activity or selected app", async () => {
  const { Harness } = setup();
  const view = render(<Harness appId={null} />);
  expect(mocks.getRunQueue).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Test queue" })).toBeNull();
  view.rerender(<Harness />);
  await waitFor(() => expect(mocks.getRunQueue).toHaveBeenCalledOnce());
  expect(screen.queryByRole("region", { name: "Test queue" })).toBeNull();
});
