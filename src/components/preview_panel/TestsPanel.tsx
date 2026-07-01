import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  currentTestSpecsAtom,
  currentTestRunStateAtom,
  setTestSpecsForAppAtom,
  setTestRunStateForAppAtom,
  type TestStatus,
} from "@/atoms/testRuntimeAtoms";
import type { TestCase, TestCaseResult, TestResult } from "@/ipc/types";
import { ipc } from "@/ipc/types";
import { useRunApp } from "@/hooks/useRunApp";
import { useStreamChat } from "@/hooks/useStreamChat";
import { cn } from "@/lib/utils";
import { showError, showInfo } from "@/lib/toast";

/**
 * Maps a Playwright-reported spec path onto a key from our spec list. The
 * report's path base can differ from the glob's (e.g. missing the "tests/"
 * prefix or being absolute), so we fall back from exact → suffix → basename.
 * Returns the original path when no unambiguous match exists.
 */
function reconcileResultFile(resultFile: string, specFiles: string[]): string {
  const normalized = resultFile.replace(/\\/g, "/");
  if (specFiles.includes(normalized)) return normalized;

  const suffixMatches = specFiles.filter(
    (f) => f.endsWith(normalized) || normalized.endsWith(f),
  );
  if (suffixMatches.length === 1) return suffixMatches[0];

  const base = normalized.split("/").pop();
  const baseMatches = specFiles.filter((f) => f.split("/").pop() === base);
  if (baseMatches.length === 1) return baseMatches[0];

  return normalized;
}

/** Stable key for an individual test ("file:line"), used for run tracking. */
function testKey(file: string, line: number | undefined): string {
  return line != null ? `${file}:${line}` : file;
}

/** Find the result for a single test within a file's result, by line then title. */
function findCaseResult(
  result: TestResult | undefined,
  testCase: TestCase,
): TestCaseResult | undefined {
  if (!result?.tests) return undefined;
  return (
    result.tests.find((t) => t.line != null && t.line === testCase.line) ??
    result.tests.find((t) => t.title === testCase.title)
  );
}

/**
 * Merge per-test results from a single-test run back into a file's existing
 * results, replacing the matched test and keeping the rest. Used so running one
 * test doesn't wipe the statuses of its siblings.
 */
function mergeCaseResults(
  existing: TestCaseResult[] | undefined,
  incoming: TestCaseResult[],
): TestCaseResult[] {
  const merged = [...(existing ?? [])];
  for (const inc of incoming) {
    const idx = merged.findIndex(
      (t) =>
        (t.line != null && inc.line != null && t.line === inc.line) ||
        t.title === inc.title,
    );
    if (idx >= 0) merged[idx] = inc;
    else merged.push(inc);
  }
  merged.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return merged;
}

/** Roll per-test results up to a file-level result (assertion > infra > pass). */
function aggregateFileResult(
  file: string,
  tests: TestCaseResult[],
): TestResult {
  let durationMs = 0;
  let hasFailed = false;
  let hasInfra = false;
  let error: string | undefined;
  let screenshotPath: string | undefined;
  for (const t of tests) {
    durationMs += t.durationMs ?? 0;
    if (t.status === "failed") hasFailed = true;
    else if (t.status === "inconclusive") hasInfra = true;
    if (t.status !== "passed") {
      if (!error && t.error) error = t.error;
      if (!screenshotPath && t.screenshotPath)
        screenshotPath = t.screenshotPath;
    }
  }
  return {
    file,
    status: hasFailed ? "failed" : hasInfra ? "inconclusive" : "passed",
    durationMs: durationMs || undefined,
    error,
    screenshotPath,
    tests,
  };
}

function statusLabel(status: TestStatus): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Test failed — your app may not match the test";
    case "inconclusive":
      return "Couldn't run — needs a fix to the test";
    case "running":
      return "Running";
    case "not-run":
    default:
      return "Not run yet";
  }
}

function StatusIcon({ status }: { status: TestStatus }) {
  switch (status) {
    case "passed":
      return (
        <CheckCircle2
          size={16}
          className="text-green-600 dark:text-green-500 shrink-0"
        />
      );
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
  (file: string, error: string | undefined, testTitle?: string): void;
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
  const canExpand = isFailing && !!result?.error;

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
            onClick={() => onAskAiToFix(file, result?.error, testCase.title)}
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
  result: TestResult | undefined;
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
            onClick={() => onAskAiToFix(file, result?.error)}
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
  const chatId = useAtomValue(selectedChatIdAtom);
  const { runApp } = useRunApp();
  const { streamMessage, isStreaming } = useStreamChat();

  const [loadingSpecs, setLoadingSpecs] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  // When enabled, runs open a visible browser window so the user can watch the
  // test drive the app, instead of running headless.
  const [headed, setHeaded] = useState(false);
  // When enabled, a file's independent tests run concurrently instead of
  // serially (Playwright `--fully-parallel` with multiple workers).
  const [parallel, setParallel] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  const devServerRunning = appUrl.appUrl !== null;
  const isRunning = runState.phase !== "idle";

  const loadSpecs = useCallback(
    ({ withSpinner }: { withSpinner: boolean }) => {
      if (selectedAppId == null) return;
      const appId = selectedAppId;
      let cancelled = false;
      if (withSpinner) setLoadingSpecs(true);
      ipc.tests
        .listAppTests({ appId })
        .then((res) => {
          if (!cancelled) setSpecs({ appId, specs: res.specs });
        })
        .catch((err) => {
          if (!cancelled) showError(err);
        })
        .finally(() => {
          if (!cancelled) setLoadingSpecs(false);
        });
      return () => {
        cancelled = true;
      };
    },
    [selectedAppId, setSpecs],
  );

  // Discover specs on mount / app change.
  useEffect(() => {
    return loadSpecs({ withSpinner: true });
  }, [loadSpecs]);

  // Re-discover specs when a chat turn finishes — the AI may have generated a
  // new test file (via <dyad-generate-test>), which wouldn't otherwise appear
  // until the panel is remounted. Done quietly, without the loading spinner.
  const prevStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      const cancel = loadSpecs({ withSpinner: false });
      prevStreamingRef.current = isStreaming;
      // Return the cancellation so a fast app-switch during this background
      // reload can't write the old app's specs into the new app's atom slot.
      return cancel;
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, loadSpecs]);

  // Subscribe to streamed run output.
  useEffect(() => {
    const unsubscribe = ipc.events.tests.onOutput((payload) => {
      setRunState({
        appId: payload.appId,
        update: (prev) => ({
          ...prev,
          phase: payload.phase,
          output: prev.output + payload.chunk,
        }),
      });
    });
    return unsubscribe;
  }, [setRunState]);

  // Auto-scroll output drawer.
  useEffect(() => {
    if (outputOpen && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [runState.output, outputOpen]);

  const runTests = useCallback(
    async (file?: string, line?: number) => {
      if (selectedAppId == null) return;
      const appId = selectedAppId;
      const isSingleTest = file != null && line != null;
      const targetFiles = file ? [file] : specs.map((s) => s.file);

      setRunState({
        appId,
        update: (prev) => ({
          ...prev,
          phase: "running",
          output: "",
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
        setRunState({
          appId,
          update: (prev) => {
            const nextResults = { ...prev.results };
            for (const r of res.results) {
              const key = reconcileResultFile(r.file, specFiles);
              const mapped: TestResult = { ...r, file: key };
              if (isSingleTest && prev.results[key]) {
                // Merge the single test's result into the file's prior results.
                const mergedTests = mergeCaseResults(
                  prev.results[key].tests,
                  mapped.tests ?? [],
                );
                nextResults[key] = aggregateFileResult(key, mergedTests);
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
    [selectedAppId, specs, setRunState, headed, parallel],
  );

  const stop = useCallback(() => {
    if (selectedAppId == null) return;
    ipc.tests.stopAppTests({ appId: selectedAppId }).catch(() => {});
  }, [selectedAppId]);

  // User-initiated only: hand the failure back into a normal chat turn.
  const askAiToFix = useCallback<AskAiToFix>(
    (file, error, testTitle) => {
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
      // Include the tail of the raw run output for extra context (capped).
      const output = runState.output.trim();
      if (output) {
        const MAX = 4000;
        const tail =
          output.length > MAX ? `…(truncated)\n${output.slice(-MAX)}` : output;
        sections.push(`Test output:\n\`\`\`\n${tail}\n\`\`\``);
      }
      streamMessage({ prompt: sections.join("\n\n"), chatId });
      showInfo("Sent to chat — asking the AI to fix the test…");
    },
    [chatId, streamMessage, runState.output],
  );

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
    for (const spec of specs) {
      const r = runState.results[spec.file];
      if (!r) continue;
      if (r.status === "passed") passed++;
      else if (r.status === "failed") failed++;
      else if (r.status === "inconclusive") inconclusive++;
    }
    return { passed, failed, inconclusive };
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
        {specs.length > 0 && (
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
        {specs.length > 0 && (
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
          specs.length > 0 && (
            <button
              onClick={() => runTests()}
              disabled={!devServerRunning}
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

      {/* Live counter (aria-live for screen readers) */}
      {(isRunning ||
        counts.passed + counts.failed + counts.inconclusive > 0) && (
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
          {` of ${specs.length}`}
          {!isRunning && runState.isolation?.mode === "neon-branch" && (
            <span
              className="ml-2 inline-flex items-center gap-1 rounded-full bg-teal-100 dark:bg-teal-900/30 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-300 align-middle"
              title="Tests ran against a temporary copy of your database — your real data was not touched."
            >
              <ShieldCheck size={11} className="shrink-0" />
              Isolated test data
            </span>
          )}
          {!isRunning && runState.isolation?.mode === "supabase-test-user" && (
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loadingSpecs ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 size={20} className="animate-spin mr-2" />
            Loading tests…
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
            <p className="text-sm text-muted-foreground max-w-sm">
              Ask the AI in chat to write a test for a feature — generated tests
              show up here. They're a starting point you can review and re-run.
            </p>
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

      {/* Collapsible raw output drawer */}
      {runState.output && (
        <div className="border-t border-border">
          <button
            onClick={() => setOutputOpen((v) => !v)}
            className="flex items-center gap-2 w-full px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-(--background-darkest) cursor-pointer"
          >
            {outputOpen ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
            Output
          </button>
          {outputOpen && (
            <pre
              ref={outputRef}
              className="text-[11px] whitespace-pre-wrap break-words bg-(--background-darkest) px-4 py-2 max-h-48 overflow-auto"
            >
              {runState.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
