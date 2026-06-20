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
import type { TestResult } from "@/ipc/types";
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

interface TestRowProps {
  appId: number;
  file: string;
  status: TestStatus;
  result?: TestResult;
  disabled: boolean;
  onRun: () => void;
  onAskAiToFix: (file: string, error: string | undefined) => void;
}

function TestRow({
  appId,
  file,
  status,
  result,
  disabled,
  onRun,
  onAskAiToFix,
}: TestRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const fileName = file.split("/").pop() ?? file;
  const isFailing = status === "failed" || status === "inconclusive";
  const canExpand = isFailing && !!result?.error;
  const screenshotPath = result?.screenshotPath;

  // Lazily load the failure screenshot when the row is expanded.
  useEffect(() => {
    if (!expanded || !screenshotPath) {
      setScreenshot(null);
      return;
    }
    let cancelled = false;
    ipc.tests
      .getTestScreenshot({ appId, path: screenshotPath })
      .then((res) => {
        if (!cancelled) setScreenshot(res.dataUrl);
      })
      .catch(() => {
        if (!cancelled) setScreenshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, screenshotPath, appId]);

  return (
    <div className="group border-b border-border/60 last:border-b-0">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <StatusIcon status={status} />
        <button
          className={cn(
            "min-w-0 flex-1 text-left",
            canExpand ? "cursor-pointer" : "cursor-default",
          )}
          onClick={() => canExpand && setExpanded((v) => !v)}
          aria-label={canExpand ? `Toggle details for ${fileName}` : undefined}
          disabled={!canExpand}
        >
          <span className="block truncate text-sm text-foreground" title={file}>
            {fileName}
          </span>
          <span
            className={cn(
              "block truncate text-[11px]",
              status === "failed"
                ? "text-red-600 dark:text-red-400"
                : status === "inconclusive"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground",
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
        {/* Fix is always visible on failing rows — it's the primary recovery
            action, so it shouldn't hide behind hover or the expander. */}
        {isFailing && (
          <button
            onClick={() => onAskAiToFix(file, result?.error)}
            aria-label={`Ask AI to fix test: ${fileName}`}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60 cursor-pointer"
          >
            <Sparkles size={13} />
            Fix
          </button>
        )}
        <button
          onClick={onRun}
          disabled={disabled}
          aria-label={`Run test: ${fileName}`}
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
      </div>
      {expanded && canExpand && (
        <div className="px-3 pb-3 pl-10 space-y-2">
          <pre className="text-[11px] whitespace-pre-wrap break-words bg-(--background-darkest) rounded-md p-2 max-h-60 overflow-auto text-red-700 dark:text-red-300">
            {result?.error}
          </pre>
          {screenshotPath && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ImageIcon size={12} />
                Failure screenshot
              </div>
              {screenshot ? (
                <img
                  src={screenshot}
                  alt={`Failure screenshot for ${fileName}`}
                  className="max-h-72 w-auto rounded-md border border-border"
                />
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  Loading screenshot…
                </div>
              )}
            </div>
          )}
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
      loadSpecs({ withSpinner: false });
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
    async (testFile?: string) => {
      if (selectedAppId == null) return;
      const appId = selectedAppId;
      const targetFiles = testFile ? [testFile] : specs.map((s) => s.file);

      setRunState({
        appId,
        update: (prev) => ({
          ...prev,
          phase: "running",
          output: "",
          runningFiles: targetFiles,
          // Keep prior results for non-targeted files; clear targeted ones.
          results: Object.fromEntries(
            Object.entries(prev.results).filter(
              ([file]) => !targetFiles.includes(file),
            ),
          ),
          runError: undefined,
          startedAt: Date.now(),
        }),
      });
      setOutputOpen(true);

      try {
        const res = await ipc.tests.runAppTests({ appId, testFile });
        // Playwright reports a spec's `file` relative to its own rootDir, which
        // may not match the glob-relative paths in our spec list (e.g. missing
        // the "tests/" prefix). Reconcile each result back onto a known spec
        // key so rows actually pick up their status.
        const specFiles = specs.map((s) => s.file);
        const resultsByFile: Record<string, TestResult> = {};
        for (const r of res.results) {
          const key = reconcileResultFile(r.file, specFiles);
          resultsByFile[key] = { ...r, file: key };
        }
        setRunState({
          appId,
          update: (prev) => ({
            ...prev,
            phase: "idle",
            runningFiles: [],
            results: { ...prev.results, ...resultsByFile },
            runError: res.infraError
              ? { message: res.infraError.message, kind: "infra" }
              : undefined,
          }),
        });
      } catch (err) {
        setRunState({
          appId,
          update: (prev) => ({
            ...prev,
            phase: "idle",
            runningFiles: [],
            runError: {
              message: err instanceof Error ? err.message : String(err),
              kind: "unknown",
            },
          }),
        });
      }
    },
    [selectedAppId, specs, setRunState],
  );

  const stop = useCallback(() => {
    if (selectedAppId == null) return;
    ipc.tests.stopAppTests({ appId: selectedAppId }).catch(() => {});
  }, [selectedAppId]);

  // User-initiated only: hand the failure back into a normal chat turn.
  const askAiToFix = useCallback(
    (file: string, error: string | undefined) => {
      if (chatId == null) {
        showInfo("Open a chat to ask the AI to fix this test.");
        return;
      }
      const sections: string[] = [
        `The end-to-end test \`${file}\` is failing. Please look at the test and the app, decide whether the test or the app is wrong, and fix the issue.`,
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

  const rowStatus = useCallback(
    (file: string): TestStatus => {
      if (runState.runningFiles.includes(file)) {
        return runState.results[file]?.status ?? "running";
      }
      return runState.results[file]?.status ?? "not-run";
    },
    [runState],
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

      {/* Run-level infra error */}
      {runState.runError && (
        <div className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span className="flex-1 whitespace-pre-wrap break-words">
            {runState.runError.message}
          </span>
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
            {specs.map((spec) => {
              const status = rowStatus(spec.file);
              return (
                <TestRow
                  key={spec.file}
                  appId={selectedAppId}
                  file={spec.file}
                  status={status}
                  result={runState.results[spec.file]}
                  disabled={isRunning || !devServerRunning}
                  onRun={() => runTests(spec.file)}
                  onAskAiToFix={askAiToFix}
                />
              );
            })}
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
