import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlaskConical,
  Play,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Circle,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Sparkles,
  Eye,
  EyeOff,
  Zap,
  ShieldCheck,
} from "lucide-react";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { currentAppUrlAtom } from "@/atoms/previewRuntimeAtoms";
import {
  appendTestRunOutputAtom,
  clearTestRunOutputForAppAtom,
  currentTestRunOutputAtom,
  currentTestSpecsAtom,
  currentTestRunStateAtom,
  setTestSpecsForAppAtom,
  setTestRunStateForAppAtom,
  type RuntimeTestResult,
  type TestStatus,
} from "@/atoms/testRuntimeAtoms";
import type { TestCase, TestCaseResult, FileAttachment } from "@/ipc/types";
import { ipc } from "@/ipc/types";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useRunApp } from "@/hooks/useRunApp";
import { useSetTestingEnabled } from "@/hooks/useSetTestingEnabled";
import { useSettings } from "@/hooks/useSettings";
import { useStreamChat } from "@/hooks/useStreamChat";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { showInfo } from "@/lib/toast";
import {
  buildSingleTestFileResult,
  findCaseResult,
  reconcileResultFile,
  statusLabel,
  testKey,
} from "./testResultUtils";

/**
 * How long streamed output chunks are buffered before one batched atom write.
 * The chattiest window (npm install / browser download progress) can emit many
 * chunks per frame; flushing on a cadence keeps that to ~10 renders/second.
 */
const OUTPUT_FLUSH_INTERVAL_MS = 100;

function StatusIcon({ status }: { status: TestStatus }) {
  switch (status) {
    case "passed":
      return (
        <CheckCircle2
          size={16}
          className="text-green-600 dark:text-green-500 shrink-0"
        />
      );
    case "partial":
      return <Circle size={16} className="text-teal-500 shrink-0" />;
    case "failed":
      return (
        <XCircle
          size={16}
          className="text-red-500 dark:text-red-400 shrink-0"
        />
      );
    case "inconclusive":
      return (
        <AlertTriangle
          size={16}
          className="text-amber-500 dark:text-amber-400 shrink-0"
        />
      );
    case "running":
      return (
        <Loader2
          size={16}
          className="animate-spin text-blue-500 dark:text-blue-400 shrink-0"
        />
      );
    case "not-run":
    default:
      return <Circle size={16} className="text-gray-400 shrink-0" />;
  }
}

function statusTextClass(status: TestStatus): string {
  switch (status) {
    case "failed":
      return "text-red-600 dark:text-red-400";
    case "inconclusive":
      return "text-amber-600 dark:text-amber-400";
    case "partial":
      return "text-teal-600 dark:text-teal-400";
    default:
      return "text-muted-foreground";
  }
}

/** Failure error text + lazily-loaded screenshot. Mounted only when expanded. */
function FailureDetails({
  appId,
  error,
  screenshotPath,
  label,
}: {
  appId: number;
  error: string | undefined;
  screenshotPath: string | undefined;
  label: string;
}) {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  // Distinguishes "still fetching" from "fetched, but unavailable" — without it
  // a null result is indistinguishable from the initial state and the UI would
  // show "Loading screenshot…" forever.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!screenshotPath) {
      setScreenshot(null);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    ipc.tests
      .getTestScreenshot({ appId, path: screenshotPath })
      .then((res) => {
        if (!cancelled) setScreenshot(res.dataUrl);
      })
      .catch(() => {
        if (!cancelled) setScreenshot(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [screenshotPath, appId]);

  return (
    <div className="space-y-2">
      {error && (
        <pre className="text-[11px] whitespace-pre-wrap break-words bg-(--background-darkest) rounded-md p-2 max-h-60 overflow-auto text-red-700 dark:text-red-300">
          {error}
        </pre>
      )}
      {screenshotPath && (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <ImageIcon size={12} />
            Failure screenshot
          </div>
          {screenshot ? (
            <img
              src={screenshot}
              alt={`Failure screenshot for ${label}`}
              className="max-h-72 w-auto rounded-md border border-border"
            />
          ) : (
            <div className="text-[11px] text-muted-foreground">
              {loaded ? "Screenshot unavailable" : "Loading screenshot…"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunButton({
  onRun,
  disabled,
  label,
}: {
  onRun: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onRun}
      disabled={disabled}
      aria-label={label}
      title="During database-isolated runs, other app operations may wait until the run finishes."
      className={cn(
        "flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-all cursor-pointer",
        "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700",
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      <Play size={13} />
      Run
    </button>
  );
}

function FixButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 cursor-pointer"
    >
      <Sparkles size={13} />
      Fix
    </button>
  );
}

interface AskAiToFix {
  (
    file: string,
    error: string | undefined,
    testTitle?: string,
    screenshotPath?: string,
  ): void;
}

interface TestCaseRowProps {
  appId: number;
  file: string;
  testCase: TestCase;
  status: TestStatus;
  result: TestCaseResult | undefined;
  disabled: boolean;
  /** Last child under its file — draws an "└" elbow instead of "├". */
  isLast: boolean;
  onRun: () => void;
  onAskAiToFix: AskAiToFix;
}

function TestCaseRow({
  appId,
  file,
  testCase,
  status,
  result,
  disabled,
  isLast,
  onRun,
  onAskAiToFix,
}: TestCaseRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isFailing = status === "failed" || status === "inconclusive";
  // Expandable when there's error text OR a failure screenshot — some failures
  // capture a screenshot without a textual error, and those still deserve to be
  // viewable.
  const canExpand = isFailing && !!(result?.error || result?.screenshotPath);

  return (
    <div className="group">
      <div className="relative flex items-center gap-2.5 py-1.5 pl-12 pr-3 hover:bg-(--background-darkest)/50">
        {/* Tree connectors: a vertical guide aligned under the file's chevron,
            and an elbow reaching across to this row's status icon. The vertical
            line stops halfway for the last child to form an "└". */}
        <span
          aria-hidden
          className="absolute left-5 top-0 w-px bg-border"
          style={{ height: isLast ? "50%" : "100%" }}
        />
        <span
          aria-hidden
          className="absolute left-5 top-1/2 h-px w-7 bg-border"
        />
        <StatusIcon status={status} />
        <button
          className={cn(
            "min-w-0 flex-1 text-left",
            canExpand ? "cursor-pointer" : "cursor-default",
          )}
          onClick={() => canExpand && setExpanded((v) => !v)}
          disabled={!canExpand}
        >
          <span
            className="block truncate text-[13px] text-foreground"
            title={testCase.title}
          >
            {testCase.title}
          </span>
          <span
            className={cn(
              "block truncate text-[11px]",
              statusTextClass(status),
            )}
          >
            {statusLabel(status)}
            {result?.durationMs != null &&
              ` · ${(result.durationMs / 1000).toFixed(1)}s`}
          </span>
        </button>
        {canExpand && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Toggle details"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        {isFailing && (
          <FixButton
            onClick={() =>
              onAskAiToFix(
                file,
                result?.error,
                testCase.title,
                result?.screenshotPath,
              )
            }
            label={`Ask AI to fix test: ${testCase.title}`}
          />
        )}
        <RunButton
          onRun={onRun}
          disabled={disabled}
          label={`Run test: ${testCase.title}`}
        />
      </div>
      {expanded && canExpand && (
        <div className="relative px-3 pb-3 pl-14">
          {/* Continue the vertical guide past the details unless this is the
              last child (whose line already terminated at the elbow). */}
          {!isLast && (
            <span
              aria-hidden
              className="absolute left-5 top-0 bottom-0 w-px bg-border"
            />
          )}
          <FailureDetails
            appId={appId}
            error={result?.error}
            screenshotPath={result?.screenshotPath}
            label={testCase.title}
          />
        </div>
      )}
    </div>
  );
}

interface FileRowProps {
  appId: number;
  file: string;
  tests: TestCase[];
  status: TestStatus;
  result: RuntimeTestResult | undefined;
  disabled: boolean;
  onRunFile: () => void;
  onRunCase: (line: number) => void;
  caseStatus: (testCase: TestCase) => TestStatus;
  caseResult: (testCase: TestCase) => TestCaseResult | undefined;
  onAskAiToFix: AskAiToFix;
}

function FileRow({
  appId,
  file,
  tests,
  status,
  result,
  disabled,
  onRunFile,
  onRunCase,
  caseStatus,
  caseResult,
  onAskAiToFix,
}: FileRowProps) {
  const fileName = file.split("/").pop() ?? file;
  const hasTests = tests.length > 0;
  const isFailing = status === "failed" || status === "inconclusive";

  const [expanded, setExpanded] = useState(false);
  // Auto-expand a file the moment it transitions into a failing state, so the
  // user immediately sees which test inside it failed.
  const prevFailing = useRef(false);
  useEffect(() => {
    if (isFailing && !prevFailing.current) setExpanded(true);
    prevFailing.current = isFailing;
  }, [isFailing]);

  const toggle = () => hasTests && setExpanded((v) => !v);

  return (
    <div className="border-b border-border/60 last:border-b-0">
      <div className="group flex items-center gap-2 px-3 py-2">
        <button
          onClick={toggle}
          disabled={!hasTests}
          aria-label={hasTests ? `Toggle tests in ${fileName}` : undefined}
          aria-expanded={hasTests ? expanded : undefined}
          className={cn(
            "shrink-0 text-muted-foreground",
            hasTests ? "cursor-pointer hover:text-foreground" : "opacity-0",
          )}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <StatusIcon status={status} />
        <button
          className={cn(
            "min-w-0 flex-1 text-left",
            hasTests ? "cursor-pointer" : "cursor-default",
          )}
          onClick={toggle}
          disabled={!hasTests}
        >
          <span
            className="block truncate text-sm font-medium text-foreground"
            title={file}
          >
            {fileName}
          </span>
          <span
            className={cn(
              "block truncate text-[11px]",
              statusTextClass(status),
            )}
          >
            {statusLabel(status)}
            {hasTests &&
              ` · ${tests.length} ${tests.length === 1 ? "test" : "tests"}`}
            {result?.durationMs != null &&
              ` · ${(result.durationMs / 1000).toFixed(1)}s`}
          </span>
        </button>
        {isFailing && (
          <FixButton
            onClick={() =>
              onAskAiToFix(
                file,
                result?.error,
                undefined,
                result?.screenshotPath,
              )
            }
            label={`Ask AI to fix tests in: ${fileName}`}
          />
        )}
        <RunButton
          onRun={onRunFile}
          disabled={disabled}
          label={`Run all tests in: ${fileName}`}
        />
      </div>
      {expanded && hasTests && (
        <div className="bg-(--background-darkest)/30">
          {tests.map((testCase, index) => (
            <TestCaseRow
              key={`${testCase.line}:${testCase.title}`}
              appId={appId}
              file={file}
              testCase={testCase}
              status={caseStatus(testCase)}
              result={caseResult(testCase)}
              disabled={disabled}
              isLast={index === tests.length - 1}
              onRun={() => onRunCase(testCase.line)}
              onAskAiToFix={onAskAiToFix}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TestsPanel() {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const specs = useAtomValue(currentTestSpecsAtom);
  const runState = useAtomValue(currentTestRunStateAtom);
  const appUrl = useAtomValue(currentAppUrlAtom);
  const setSpecs = useSetAtom(setTestSpecsForAppAtom);
  const setRunState = useSetAtom(setTestRunStateForAppAtom);
  const appendOutput = useSetAtom(appendTestRunOutputAtom);
  const clearOutput = useSetAtom(clearTestRunOutputForAppAtom);
  // For lazy, subscription-free reads of the streamed output (askAiToFix runs
  // long after the chunks arrive; subscribing would re-render the whole panel
  // on every flush and defeat the point of the separate output atom).
  const jotaiStore = useStore();
  const chatId = useAtomValue(selectedChatIdAtom);
  const { app } = useLoadApp(selectedAppId);
  const { settings } = useSettings();
  const { runApp } = useRunApp();
  const { setTestingEnabled, isLoading: isTogglingTesting } =
    useSetTestingEnabled();
  const { streamMessage, isStreaming } = useStreamChat();
  const queryClient = useQueryClient();

  // Per-app opt-in gate. Running tests can mutate the app's real data, so every
  // run/generate control stays hidden behind the opt-in screen until the user
  // explicitly enables testing for this app (after seeing the backup warning).
  const testingEnabled = app?.testingEnabled ?? false;
  // Provider drives how loud the backup warning is: Neon runs against a
  // throwaway branch copy (safe, no banner); Supabase runs as an isolated
  // RLS-scoped test user (safer, but RLS gaps are possible); anything else has
  // no isolation, so the warning is strongest.
  const hasNeon = !!app?.neonProjectId;
  const hasSupabase = !!app?.supabaseProjectId;
  const hasNeonIsolation =
    hasNeon && (settings?.runtimeMode2 ?? "host") === "host";
  const hasSupabaseIsolation = hasSupabase && !!app?.supabaseOrganizationSlug;

  const [outputOpen, setOutputOpen] = useState(false);
  // When enabled, runs open a visible browser window so the user can watch the
  // test drive the app, instead of running headless.
  const [headed, setHeaded] = useState(false);
  // When enabled, a file's independent tests run concurrently instead of
  // serially (Playwright `--fully-parallel` with multiple workers).
  const [parallel, setParallel] = useState(false);

  const devServerRunning = appUrl.appUrl !== null;
  const isRunning = runState.phase !== "idle";
  const specsQuery = useQuery({
    queryKey: queryKeys.tests.list({ appId: selectedAppId }),
    queryFn: async () => {
      if (selectedAppId == null) {
        return { specs: [] };
      }
      return ipc.tests.listAppTests({ appId: selectedAppId });
    },
    enabled: selectedAppId != null,
    meta: { showErrorToast: true },
  });

  useEffect(() => {
    if (selectedAppId == null || !specsQuery.data) return;
    setSpecs({ appId: selectedAppId, specs: specsQuery.data.specs });
  }, [selectedAppId, setSpecs, specsQuery.data]);

  // Re-discover specs when a chat turn finishes - the AI may have generated a
  // new test file (via <dyad-generate-test>), which wouldn't otherwise appear
  // until the panel is remounted. Done quietly, without the loading spinner.
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && selectedAppId != null) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tests.list({ appId: selectedAppId }),
      });
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, queryClient, selectedAppId]);

  const loadingSpecs = specsQuery.isLoading && specs.length === 0;
  const showNeonRestartDisclosure =
    specs.length > 0 &&
    !!app?.neonProjectId &&
    (settings?.runtimeMode2 ?? "host") === "host";
  const pendingOutputRef = useRef(new Map<number, string>());
  const outputFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const flushPendingOutput = useCallback(
    (appId?: number) => {
      const pending = pendingOutputRef.current;
      const entries =
        appId === undefined
          ? Array.from(pending.entries())
          : pending.has(appId)
            ? [[appId, pending.get(appId)!] as const]
            : [];
      for (const [pendingAppId, chunk] of entries) {
        appendOutput({ appId: pendingAppId, chunk });
        pending.delete(pendingAppId);
      }
      if (pending.size === 0 && outputFlushTimerRef.current) {
        clearTimeout(outputFlushTimerRef.current);
        outputFlushTimerRef.current = null;
      }
    },
    [appendOutput],
  );

  // Subscribe to streamed run output. Chunks are buffered and flushed as one
  // batched atom write per interval — an atom write per chunk would re-render
  // every subscriber per chunk during the chattiest window.
  useEffect(() => {
    // All test activity lives behind the opt-in gate; don't register the IPC
    // listener (or accumulate output) for apps that haven't enabled testing.
    if (!testingEnabled) return;
    const unsubscribe = ipc.events.tests.onOutput((payload) => {
      const pending = pendingOutputRef.current;
      pending.set(
        payload.appId,
        (pending.get(payload.appId) ?? "") + payload.chunk,
      );
      outputFlushTimerRef.current ??= setTimeout(() => {
        outputFlushTimerRef.current = null;
        flushPendingOutput();
      }, OUTPUT_FLUSH_INTERVAL_MS);
      // Phase transitions are rare (setup → running); returning the previous
      // state on no-change makes this write a no-op for subscribers.
      setRunState({
        appId: payload.appId,
        update: (prev) =>
          prev.phase === "idle" || prev.phase === payload.phase
            ? prev
            : { ...prev, phase: payload.phase },
      });
    });
    return () => {
      unsubscribe();
      if (outputFlushTimerRef.current) {
        clearTimeout(outputFlushTimerRef.current);
        outputFlushTimerRef.current = null;
      }
      flushPendingOutput();
    };
  }, [setRunState, flushPendingOutput, testingEnabled]);

  const runTests = useCallback(
    async (file?: string, line?: number) => {
      if (selectedAppId == null) return;
      const appId = selectedAppId;
      const isSingleTest = file != null && line != null;
      const targetFiles = file ? [file] : specs.map((s) => s.file);

      flushPendingOutput(appId);
      clearOutput(appId);
      setRunState({
        appId,
        update: (prev) => ({
          ...prev,
          phase: "running",
          runningFiles: targetFiles,
          runningTests: isSingleTest ? [testKey(file, line)] : [],
          // For a single-test run, keep the file's existing results (siblings
          // keep their status; we merge the one test back in afterward). For a
          // file/all run, clear the targeted files.
          results: isSingleTest
            ? prev.results
            : Object.fromEntries(
                Object.entries(prev.results).filter(
                  ([f]) => !targetFiles.includes(f),
                ),
              ),
          runError: undefined,
          isolation: undefined,
          startedAt: Date.now(),
        }),
      });
      setOutputOpen(true);

      try {
        const res = await ipc.tests.runAppTests({
          appId,
          testFile: file,
          testLine: line,
          headed,
          // A single targeted test can't parallelize, so only opt in for
          // file/all runs.
          parallel: parallel && !isSingleTest,
        });
        // Playwright reports a spec's `file` relative to its own rootDir, which
        // may not match the glob-relative paths in our spec list (e.g. missing
        // the "tests/" prefix). Reconcile each result back onto a known spec
        // key so rows actually pick up their status.
        const specFiles = specs.map((s) => s.file);
        const specsByFile = new Map(specs.map((s) => [s.file, s]));
        setRunState({
          appId,
          update: (prev) => {
            const nextResults = { ...prev.results };
            for (const r of res.results) {
              const key = reconcileResultFile(r.file, specFiles);
              const mapped = { ...r, file: key };
              if (isSingleTest) {
                nextResults[key] = buildSingleTestFileResult({
                  file: key,
                  knownTests: specsByFile.get(key)?.tests ?? [],
                  previous: prev.results[key],
                  incoming: mapped,
                });
              } else {
                nextResults[key] = mapped;
              }
            }
            return {
              ...prev,
              phase: "idle",
              runningFiles: [],
              runningTests: [],
              results: nextResults,
              runError: res.infraError
                ? { message: res.infraError.message, kind: "infra" }
                : undefined,
              isolation: res.isolation,
            };
          },
        });
      } catch (err) {
        setRunState({
          appId,
          update: (prev) => ({
            ...prev,
            phase: "idle",
            runningFiles: [],
            runningTests: [],
            runError: {
              message: err instanceof Error ? err.message : String(err),
              kind: "unknown",
            },
          }),
        });
      }
    },
    [
      selectedAppId,
      specs,
      flushPendingOutput,
      clearOutput,
      setRunState,
      headed,
      parallel,
    ],
  );

  const stop = useCallback(() => {
    if (selectedAppId == null) return;
    ipc.tests.stopAppTests({ appId: selectedAppId }).catch(() => {});
  }, [selectedAppId]);

  // User-initiated only: hand the failure back into a normal chat turn.
  const askAiToFix = useCallback<AskAiToFix>(
    async (file, error, testTitle, screenshotPath) => {
      if (chatId == null) {
        showInfo("Open a chat to ask the AI to fix this test.");
        return;
      }
      const target = testTitle
        ? `The end-to-end test "${testTitle}" in \`${file}\` is failing.`
        : `The end-to-end test \`${file}\` is failing.`;
      const sections: string[] = [
        `${target} Please look at the test and the app, decide whether the test or the app is wrong, and fix the issue.`,
      ];
      if (error) {
        sections.push(`Error:\n\`\`\`\n${error.trim()}\n\`\`\``);
      }
      // Include the tail of the raw run output for extra context (capped). Read
      // lazily from the store so this callback doesn't subscribe to the
      // streamed output and get recreated (re-rendering every row) per flush.
      const output = jotaiStore.get(currentTestRunOutputAtom).trim();
      if (output) {
        const MAX = 4000;
        const tail =
          output.length > MAX ? `…(truncated)\n${output.slice(-MAX)}` : output;
        sections.push(`Test output:\n\`\`\`\n${tail}\n\`\`\``);
      }

      // Attach the failure screenshot as an image so the model can see the
      // actual UI state at the point of failure. This is the only way the
      // screenshot reaches the model: the agent's file tools read PNGs as UTF-8
      // text, so pointing it at the on-disk path wouldn't work. Chat-context
      // image attachments are converted to model image parts server-side.
      let attachments: FileAttachment[] | undefined;
      if (screenshotPath && selectedAppId != null) {
        try {
          const { dataUrl } = await ipc.tests.getTestScreenshot({
            appId: selectedAppId,
            path: screenshotPath,
          });
          if (dataUrl) {
            const blob = await (await fetch(dataUrl)).blob();
            const name =
              screenshotPath.split(/[\\/]/).pop() || "screenshot.png";
            const screenshotFile = new File([blob], name, {
              type: blob.type || "image/png",
            });
            attachments = [{ file: screenshotFile, type: "chat-context" }];
            sections.push(
              "The attached image is the failure screenshot captured at the point the test failed — use it to see the real UI state.",
            );
          }
        } catch {
          // Non-fatal: the screenshot may have been cleared between runs. Fall
          // back to a text-only message rather than blocking the fix request.
        }
      }

      streamMessage({ prompt: sections.join("\n\n"), chatId, attachments });
      showInfo("Sent to chat — asking the AI to fix the test…");
    },
    [chatId, streamMessage, jotaiStore, selectedAppId],
  );

  // Kick off a first test by asking the AI (in chat) to cover a critical flow.
  // The generated <dyad-generate-test> spec surfaces back in this panel once the
  // turn finishes (see the invalidate-on-stream-end effect above).
  const generateTest = useCallback(() => {
    if (chatId == null) {
      showInfo("Open a chat to generate a test.");
      return;
    }
    streamMessage({
      prompt:
        "Generate an end-to-end test for a critical user journey in this app. First explore the app to find its most important flow, then write a single Playwright test that covers it.",
      chatId,
    });
    showInfo("Sent to chat — generating a test…");
  }, [chatId, streamMessage]);

  const enableTesting = useCallback(() => {
    if (selectedAppId == null) return;
    setTestingEnabled({ appId: selectedAppId, enabled: true });
  }, [selectedAppId, setTestingEnabled]);

  const disableTesting = useCallback(() => {
    if (selectedAppId == null) return;
    setTestingEnabled({ appId: selectedAppId, enabled: false });
  }, [selectedAppId, setTestingEnabled]);
  const toggleOutput = useCallback(() => {
    setOutputOpen((v) => !v);
  }, []);

  // File-level status: a spinner while the file is part of an in-flight run,
  // otherwise the parsed run result (or not-run).
  const fileStatus = useCallback(
    (file: string): TestStatus => {
      if (isRunning && runState.runningFiles.includes(file)) return "running";
      return runState.results[file]?.status ?? "not-run";
    },
    [isRunning, runState.runningFiles, runState.results],
  );

  // Per-test status. A test spins when it's the specific test being run, or
  // when its whole file is running (no single test targeted).
  const caseStatus = useCallback(
    (file: string, testCase: TestCase): TestStatus => {
      if (isRunning) {
        const runningTests = runState.runningTests ?? [];
        const isThisRunning =
          runningTests.length > 0
            ? runningTests.includes(testKey(file, testCase.line))
            : runState.runningFiles.includes(file);
        if (isThisRunning) return "running";
      }
      return (
        findCaseResult(runState.results[file], testCase)?.status ?? "not-run"
      );
    },
    [isRunning, runState.runningFiles, runState.runningTests, runState.results],
  );

  const caseResult = useCallback(
    (file: string, testCase: TestCase): TestCaseResult | undefined =>
      findCaseResult(runState.results[file], testCase),
    [runState.results],
  );

  const counts = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let inconclusive = 0;
    let partial = 0;
    for (const spec of specs) {
      const r = runState.results[spec.file];
      if (!r) continue;
      if (r.status === "passed") passed++;
      else if (r.status === "failed") failed++;
      else if (r.status === "inconclusive") inconclusive++;
      else if (r.status === "partial") partial++;
    }
    return { passed, failed, inconclusive, partial };
  }, [specs, runState.results]);

  if (selectedAppId == null) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground">
        <FlaskConical size={32} className="mb-3 opacity-50" />
        <p>Select an app to view tests.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <FlaskConical size={18} className="text-teal-600 dark:text-teal-400" />
        <h2 className="text-base font-semibold text-foreground">Tests</h2>
        <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded">
          Experimental
        </span>
        <div className="flex-1" />
        {testingEnabled && !isRunning && (
          <button
            onClick={disableTesting}
            disabled={isTogglingTesting}
            aria-label="Disable testing for this app"
            className={cn(
              "text-xs px-2 py-1 rounded-md text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer",
              isTogglingTesting && "opacity-40 cursor-not-allowed",
            )}
          >
            Disable testing
          </button>
        )}
        {testingEnabled && specs.length > 0 && (
          <button
            onClick={() => setParallel((v) => !v)}
            disabled={isRunning}
            aria-pressed={parallel}
            title={
              parallel
                ? "Parallel: a file's tests run concurrently (faster, shared dev server)"
                : "Serial: a file's tests run one at a time"
            }
            aria-label={
              parallel ? "Switch to serial mode" : "Switch to parallel mode"
            }
            className={cn(
              "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md cursor-pointer transition-colors",
              parallel
                ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-900/60"
                : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700",
              isRunning && "opacity-40 cursor-not-allowed",
            )}
          >
            <Zap size={14} />
            {parallel ? "Parallel" : "Serial"}
          </button>
        )}
        {testingEnabled && specs.length > 0 && (
          <button
            onClick={() => setHeaded((v) => !v)}
            disabled={isRunning}
            aria-pressed={headed}
            title={
              headed
                ? "Headed: tests open a visible browser window"
                : "Headless: tests run without a visible window"
            }
            aria-label={
              headed ? "Switch to headless mode" : "Switch to headed mode"
            }
            className={cn(
              "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md cursor-pointer transition-colors",
              headed
                ? "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-900/60"
                : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700",
              isRunning && "opacity-40 cursor-not-allowed",
            )}
          >
            {headed ? <Eye size={14} /> : <EyeOff size={14} />}
            {headed ? "Headed" : "Headless"}
          </button>
        )}
        {isRunning ? (
          <button
            onClick={stop}
            aria-label="Stop running tests"
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 cursor-pointer"
          >
            <Square size={14} />
            Stop
          </button>
        ) : (
          testingEnabled &&
          specs.length > 0 && (
            <button
              onClick={() => runTests()}
              disabled={!devServerRunning}
              title="During database-isolated runs, other app operations may wait until the run finishes."
              aria-label="Run all tests"
              className={cn(
                "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md cursor-pointer",
                "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60",
                !devServerRunning && "opacity-40 cursor-not-allowed",
              )}
            >
              <Play size={14} />
              Run all
            </button>
          )
        )}
      </div>

      {/* Run-related status + banners only apply once testing is enabled. */}
      {testingEnabled && (
        <>
          {/* Live counter (aria-live for screen readers) */}
          {(isRunning ||
            counts.passed +
              counts.failed +
              counts.inconclusive +
              counts.partial >
              0) && (
            <div
              aria-live="polite"
              className="px-4 py-1.5 text-xs text-muted-foreground border-b border-border/60"
            >
              {isRunning && (
                <span className="text-blue-600 dark:text-blue-400">
                  {runState.phase === "setup"
                    ? "Setting up testing… "
                    : "Running… "}
                </span>
              )}
              <span className="text-green-600 dark:text-green-500">
                {counts.passed} passed
              </span>
              {counts.failed > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  {" · "}
                  {counts.failed} failed
                </span>
              )}
              {counts.inconclusive > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {" · "}
                  {counts.inconclusive} inconclusive
                </span>
              )}
              {counts.partial > 0 && (
                <span className="text-teal-600 dark:text-teal-400">
                  {" · "}
                  {counts.partial} partial
                </span>
              )}
              {` of ${specs.length} ${specs.length === 1 ? "file" : "files"}`}
              {!isRunning && runState.isolation?.mode === "neon-branch" && (
                <span
                  className="ml-2 inline-flex items-center gap-1 rounded-full bg-teal-100 dark:bg-teal-900/30 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-300 align-middle"
                  title="Tests ran against a temporary copy of your database — your real data was not touched."
                >
                  <ShieldCheck size={11} className="shrink-0" />
                  Isolated test data
                </span>
              )}
              {!isRunning &&
                runState.isolation?.mode === "supabase-test-user" && (
                  <span
                    className="ml-2 inline-flex items-center gap-1 rounded-full bg-teal-100 dark:bg-teal-900/30 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-300 align-middle"
                    title="Tests ran as a temporary, isolated test user under Row-Level Security — your real data was not touched."
                  >
                    <ShieldCheck size={11} className="shrink-0" />
                    Isolated test user
                  </span>
                )}
            </div>
          )}

          {/* Disclosure / warning: either ran against current data (no isolation),
          or ran as an isolated Supabase test user but some tables lack RLS.
          Both surface via `reason`. Calm info, not an error — runs still
          completed. Suppressed when a dead-end infra error is already shown.
          (Neon's fully-isolated path never sets a reason.) */}
          {!isRunning &&
            !runState.runError &&
            runState.isolation?.mode !== "neon-branch" &&
            runState.isolation?.reason && (
              <div className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span className="flex-1">{runState.isolation.reason}</span>
              </div>
            )}

          {!isRunning && showNeonRestartDisclosure && (
            <div className="flex items-start gap-2 px-4 py-2 bg-teal-50 dark:bg-teal-900/20 border-b border-teal-200 dark:border-teal-800 text-sm text-teal-800 dark:text-teal-200">
              <ShieldCheck size={15} className="shrink-0 mt-0.5" />
              <span className="flex-1">
                Neon test runs restart the preview to switch to a temporary
                database, then restart it again afterward.
              </span>
            </div>
          )}

          {/* Dev-server gate banner */}
          {!devServerRunning && specs.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle size={15} className="shrink-0" />
              <span className="flex-1">Start the app to run tests.</span>
              <button
                onClick={() => runApp(selectedAppId)}
                className="px-2 py-1 rounded-md bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 cursor-pointer text-xs font-medium"
              >
                Start
              </button>
            </div>
          )}

          {/* Run-level infra error (includes the isolation dead-end). Offers a safe
          Retry — never an option to run against real data. */}
          {runState.runError && (
            <div className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" />
              <span className="flex-1 whitespace-pre-wrap break-words">
                {runState.runError.message}
              </span>
              <button
                onClick={() => runTests()}
                disabled={isRunning || !devServerRunning}
                className={cn(
                  "shrink-0 px-2 py-1 rounded-md bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 cursor-pointer text-xs font-medium",
                  (isRunning || !devServerRunning) &&
                    "opacity-40 cursor-not-allowed",
                )}
              >
                Retry
              </button>
            </div>
          )}
        </>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {!testingEnabled ? (
          <EnableTestingScreen
            hasNeonIsolation={hasNeonIsolation}
            hasSupabaseIsolation={hasSupabaseIsolation}
            hasManagedDatabase={hasNeon || hasSupabase}
            onEnable={enableTesting}
            isEnabling={isTogglingTesting}
          />
        ) : loadingSpecs ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 size={20} className="animate-spin mr-2" />
            Loading tests…
          </div>
        ) : specsQuery.isError ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <AlertTriangle
              size={28}
              className="mb-3 text-amber-500 dark:text-amber-400"
            />
            <h3 className="text-base font-semibold text-foreground mb-2">
              Couldn&apos;t load tests
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              The test list couldn&apos;t be read for this app.
            </p>
            <button
              onClick={() => void specsQuery.refetch()}
              className="px-3 py-1.5 rounded-md bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 cursor-pointer text-xs font-medium text-amber-900 dark:text-amber-100"
            >
              Retry
            </button>
          </div>
        ) : specs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mb-4">
              <FlaskConical
                size={22}
                className="text-teal-600 dark:text-teal-400"
              />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No tests yet
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-5">
              Generate your first test, or ask the AI in chat to write one for a
              specific feature. Generated tests show up here as a starting point
              you can review and re-run.
            </p>
            <button
              onClick={generateTest}
              disabled={isStreaming}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium cursor-pointer",
                "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60",
                isStreaming && "opacity-40 cursor-not-allowed",
              )}
            >
              <Sparkles size={16} />
              Generate a test for a critical user journey
            </button>
          </div>
        ) : (
          <div>
            {specs.map((spec) => (
              <FileRow
                key={spec.file}
                appId={selectedAppId}
                file={spec.file}
                tests={spec.tests}
                status={fileStatus(spec.file)}
                result={runState.results[spec.file]}
                disabled={isRunning || !devServerRunning}
                onRunFile={() => runTests(spec.file)}
                onRunCase={(line) => runTests(spec.file, line)}
                caseStatus={(testCase) => caseStatus(spec.file, testCase)}
                caseResult={(testCase) => caseResult(spec.file, testCase)}
                onAskAiToFix={askAiToFix}
              />
            ))}
          </div>
        )}
      </div>

      <OutputDrawer open={outputOpen} onToggle={toggleOutput} />
    </div>
  );
}

/**
 * Opt-in gate shown until the user enables testing for this app. Explains what
 * testing does, warns about data safety (scaled to the app's DB provider), and
 * enables the feature on click.
 */
function EnableTestingScreen({
  hasNeonIsolation,
  hasSupabaseIsolation,
  hasManagedDatabase,
  onEnable,
  isEnabling,
}: {
  hasNeonIsolation: boolean;
  hasSupabaseIsolation: boolean;
  hasManagedDatabase: boolean;
  onEnable: () => void;
  isEnabling: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mb-4">
        <FlaskConical size={22} className="text-teal-600 dark:text-teal-400" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        Enable testing for this app
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-5">
        Let Dyad write and run end-to-end tests that drive your app like a real
        user. Tests are a starting point you can review, edit, and re-run.
      </p>

      {/* Data-safety warning, scaled to how well runs are isolated for this
          app's backend. Neon runs against a throwaway branch copy, so it's safe
          enough to skip the banner; everything else can touch real data. */}
      {hasNeonIsolation ? (
        <div className="flex items-start gap-2 max-w-sm mb-5 px-3 py-2 rounded-md bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 text-left text-[13px] text-teal-800 dark:text-teal-200">
          <ShieldCheck size={15} className="shrink-0 mt-0.5" />
          <span>
            Tests run against a temporary copy of your Neon database, so your
            real data isn&apos;t touched.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 max-w-sm mb-5 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-left text-[13px] text-amber-800 dark:text-amber-200">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>
            {hasSupabaseIsolation
              ? "Tests run as an isolated test user under Row-Level Security, but RLS may not cover every table. We strongly recommend enabling data backups before running tests, in case they do something unintended."
              : hasManagedDatabase
                ? "Dyad can't isolate this database in the current setup. These tests can create, update, or delete current data, so we strongly recommend enabling data backups before running them."
                : "These tests can create, update, or delete real data, and Dyad can't isolate a custom or non-database backend. We strongly recommend enabling data backups before running tests, in case they do something unintended."}
          </span>
        </div>
      )}

      <button
        onClick={onEnable}
        disabled={isEnabling}
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium cursor-pointer",
          "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-900/60",
          isEnabling && "opacity-40 cursor-not-allowed",
        )}
      >
        {isEnabling ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <FlaskConical size={16} />
        )}
        Enable testing for this app
      </button>
    </div>
  );
}

// Collapsible raw output drawer. The only component that subscribes to the
// streamed output atom, and memoized so per-flush appends re-render just this
// drawer (and its auto-scroll) instead of the whole panel and every test row.
const OutputDrawer = memo(function OutputDrawer({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const output = useAtomValue(currentTestRunOutputAtom);
  const outputRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to the newest output.
  useEffect(() => {
    if (open && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, open]);

  if (!output) return null;

  return (
    <div className="border-t border-border">
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-label="Toggle test output"
        className="flex items-center gap-2 w-full px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-(--background-darkest) cursor-pointer"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Output
      </button>
      {open && (
        <pre
          ref={outputRef}
          className="text-[11px] whitespace-pre-wrap break-words bg-(--background-darkest) px-4 py-2 max-h-48 overflow-auto"
        >
          {output}
        </pre>
      )}
    </div>
  );
});
