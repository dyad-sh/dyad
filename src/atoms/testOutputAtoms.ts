import { atom } from "jotai";
import { selectedAppIdAtom } from "./appAtoms";

/** Keep the tail of each run's output, including verbose setup logs. */
export const MAX_TEST_RUN_OUTPUT_LENGTH = 500_000;

interface TestOutputTab {
  runId: number;
  ordinal: number;
  target?: string;
  fileCount: number;
  output: string;
  error?: string;
}

interface TestOutputTabs {
  tabs: TestOutputTab[];
  selectedRunId: number | null;
  nextOrdinal: number;
}

const EMPTY_OUTPUT_TABS: TestOutputTabs = {
  tabs: [],
  selectedRunId: null,
  nextOrdinal: 1,
};

// Window-local presentation history survives leaving Tests and switching apps.
// Closing a tab only dismisses its output; execution remains owned by main.
const testOutputTabsByAppIdAtom = atom<Map<number, TestOutputTabs>>(new Map());

export const currentTestOutputTabsAtom = atom((get) => {
  const appId = get(selectedAppIdAtom);
  return appId === null
    ? EMPTY_OUTPUT_TABS
    : (get(testOutputTabsByAppIdAtom).get(appId) ?? EMPTY_OUTPUT_TABS);
});

export const openTestOutputTabAtom = atom(
  null,
  (
    _get,
    set,
    {
      appId,
      runId,
      target,
      fileCount,
    }: { appId: number; runId: number; target?: string; fileCount: number },
  ) => {
    set(testOutputTabsByAppIdAtom, (prev) => {
      const current = prev.get(appId) ?? EMPTY_OUTPUT_TABS;
      if (current.tabs.some((tab) => tab.runId === runId)) return prev;
      const next = new Map(prev);
      next.set(appId, {
        nextOrdinal: current.nextOrdinal + 1,
        tabs: [
          ...current.tabs,
          {
            runId,
            ordinal: current.nextOrdinal,
            target,
            fileCount,
            output: "",
          },
        ].sort((a, b) => a.runId - b.runId),
        // An older bootstrap snapshot must not steal a newer live run's tab.
        selectedRunId: current.tabs.some((tab) => tab.runId > runId)
          ? current.selectedRunId
          : runId,
      });
      return next;
    });
  },
);

export const setTestOutputTabErrorAtom = atom(
  null,
  (
    _get,
    set,
    { appId, runId, error }: { appId: number; runId: number; error?: string },
  ) => {
    set(testOutputTabsByAppIdAtom, (prev) => {
      const current = prev.get(appId);
      if (!current?.tabs.some((tab) => tab.runId === runId)) return prev;
      return new Map(prev).set(appId, {
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.runId === runId ? { ...tab, error } : tab,
        ),
      });
    });
  },
);

export const appendTestOutputTabAtom = atom(
  null,
  (
    _get,
    set,
    { appId, runId, chunk }: { appId: number; runId: number; chunk: string },
  ) => {
    if (!chunk) return;
    set(testOutputTabsByAppIdAtom, (prev) => {
      const current = prev.get(appId);
      // Buffered/late output must not reopen a tab the user closed.
      if (!current?.tabs.some((tab) => tab.runId === runId)) return prev;
      const next = new Map(prev);
      next.set(appId, {
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.runId === runId
            ? {
                ...tab,
                output: (tab.output + chunk).slice(-MAX_TEST_RUN_OUTPUT_LENGTH),
              }
            : tab,
        ),
      });
      return next;
    });
  },
);

export const selectTestOutputTabAtom = atom(
  null,
  (_get, set, { appId, runId }: { appId: number; runId: number }) => {
    set(testOutputTabsByAppIdAtom, (prev) => {
      const current = prev.get(appId);
      if (
        !current?.tabs.some((tab) => tab.runId === runId) ||
        current.selectedRunId === runId
      )
        return prev;
      const next = new Map(prev);
      next.set(appId, { ...current, selectedRunId: runId });
      return next;
    });
  },
);

export const closeTestOutputTabAtom = atom(
  null,
  (_get, set, { appId, runId }: { appId: number; runId: number }) => {
    set(testOutputTabsByAppIdAtom, (prev) => {
      const current = prev.get(appId);
      if (!current) return prev;
      const index = current.tabs.findIndex((tab) => tab.runId === runId);
      if (index < 0) return prev;
      const tabs = current.tabs.filter((tab) => tab.runId !== runId);
      const next = new Map(prev);
      next.set(appId, {
        ...current,
        tabs,
        selectedRunId:
          current.selectedRunId === runId
            ? (tabs[Math.min(index, tabs.length - 1)]?.runId ?? null)
            : current.selectedRunId,
      });
      return next;
    });
  },
);

export const clearTestOutputTabsForAppAtom = atom(
  null,
  (_get, set, appId: number) => {
    set(testOutputTabsByAppIdAtom, (prev) => {
      if (!prev.has(appId)) return prev;
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  },
);
