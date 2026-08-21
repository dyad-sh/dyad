import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  ShieldAlert,
  ShieldCheck,
  CircleDot,
  Code,
  Trash2,
  Settings2,
} from "lucide-react";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { previewNativeViewAppIdAtom } from "@/atoms/previewAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useCurrentAppUrl } from "@/hooks/useAppRun";
import { selectedFileAtom } from "@/atoms/viewAtoms";
import { clearStagedDiffAtom } from "@/atoms/commitAtoms";
import {
  currentRecordingStateAtom,
  recordingStartRequestAtom,
} from "@/atoms/recorderAtoms";
import {
  applyTestRunFinishedAtom,
  applyTestRunStartedAtom,
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
import { useDeleteAppTest } from "@/hooks/useDeleteAppTest";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useSwitchToPublishableKey } from "@/hooks/useLegacySupabaseKey";
import { runAppLifecycleInBackground, useRunApp } from "@/hooks/useRunApp";
import { useSetTestingEnabled } from "@/hooks/useSetTestingEnabled";
import { useSettings } from "@/hooks/useSettings";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useStreamFinished } from "@/chat_stream/ChatStreamProvider";
import { useChatMode } from "@/hooks/useChatMode";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AgentModeRequiredDialog } from "./AgentModeRequiredDialog";
import { MigrateTestsBanner } from "./MigrateTestsBanner";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { showError, showInfo, showSuccess } from "@/lib/toast";
import { findCaseResult, statusLabel, testKey } from "@/lib/testResultUtils";
import { usePreviewIframeController } from "@/preview_iframe/usePreviewIframe";
import { sameOriginStartPath } from "./previewAddressPath";

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
          role="img"
          aria-label="Running"
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
  title,
}: {
  onRun: () => void;
  disabled: boolean;
  label: string;
  /** Overrides the default hint, e.g. to say why the button is disabled. */
  title?: string;
}) {
  return (
    <button
      onClick={onRun}
      disabled={disabled}
      aria-label={label}
      title={
        title ??
        "During database-isolated runs, other app operations may wait until the run finishes."
      }
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

/**
 * Row action rendered as an icon only, revealed on hover/focus like RunButton
 * so a row's chrome stays quiet until the user reaches for it.
 */
function IconRowButton({
  onClick,
  label,
  title,
  disabled,
  danger,
  testId,
  children,
}: {
  onClick: () => void;
  label: string;
  title: string;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      data-testid={testId}
      className={cn(
        "flex items-center p-1 rounded-md transition-all cursor-pointer shrink-0",
        danger
          ? "text-gray-700 dark:text-gray-300 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40 dark:hover:text-red-300"
          : "text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700",
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      {children}
    </button>
  );
}

function OpenInEditorButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <IconRowButton
      onClick={onClick}
      label={label}
      title="Open in the code editor"
    >
      {/* Same icon as the toolbar's code-view button, so the row action reads
          as "switch to code" rather than "open elsewhere". */}
      <Code size={13} />
    </IconRowButton>
  );
}

function DeleteButton({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <IconRowButton
      onClick={onClick}
      label={label}
      title={
        disabled
          ? "Can't delete a test file while tests are running"
          : "Delete this test file"
      }
      disabled={disabled}
      danger
      testId="delete-test-file-button"
    >
      <Trash2 size={13} />
    </IconRowButton>
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
  /** Explains a disabled Run button; the default hint applies when unset. */
  runTitle?: string;
  /** Last child under its file — draws an "└" elbow instead of "├". */
  isLast: boolean;
  onRun: () => void;
  onOpenInEditor: () => void;
  onAskAiToFix: AskAiToFix;
}

function TestCaseRow({
  appId,
  file,
  testCase,
  status,
  result,
  disabled,
  runTitle,
  isLast,
  onRun,
  onOpenInEditor,
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
          title={runTitle}
          label={`Run test: ${testCase.title}`}
        />
        <OpenInEditorButton
          onClick={onOpenInEditor}
          label={`Open test in code editor: ${testCase.title}`}
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
  /** Explains a disabled Run button; the default hint applies when unset. */
  runTitle?: string;
  /**
   * Deleting mutates the spec on disk, so it's blocked while a run is in
   * flight — separate from `disabled`, which also covers "dev server down"
   * (a state that only stops runs).
   */
  deleteDisabled: boolean;
  onRunFile: () => void;
  onRunCase: (line: number) => void;
  onOpenInEditor: (line?: number) => void;
  onDelete: () => void;
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
  runTitle,
  deleteDisabled,
  onRunFile,
  onRunCase,
  onOpenInEditor,
  onDelete,
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
          title={runTitle}
          label={`Run all tests in: ${fileName}`}
        />
        <OpenInEditorButton
          onClick={() => onOpenInEditor()}
          label={`Open in code editor: ${fileName}`}
        />
        <DeleteButton
          onClick={onDelete}
          disabled={deleteDisabled}
          label={`Delete test file: ${fileName}`}
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
              runTitle={runTitle}
              isLast={index === tests.length - 1}
              onRun={() => onRunCase(testCase.line)}
              onOpenInEditor={() => onOpenInEditor(testCase.line)}
              onAskAiToFix={onAskAiToFix}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TestsPanel() {
  const { t } = useTranslation("home");
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const specs = useAtomValue(currentTestSpecsAtom);
  const runState = useAtomValue(currentTestRunStateAtom);
  const appUrl = useCurrentAppUrl(selectedAppId);
  const { state: previewIframeState } =
    usePreviewIframeController(selectedAppId);
  const setSpecs = useSetAtom(setTestSpecsForAppAtom);
  const setRunState = useSetAtom(setTestRunStateForAppAtom);
  const setPreviewMode = useSetAtom(previewModeAtom);
  const setPreviewNativeViewAppId = useSetAtom(previewNativeViewAppIdAtom);
  const setSelectedFile = useSetAtom(selectedFileAtom);
  const clearStagedDiff = useSetAtom(clearStagedDiffAtom);
  // For lazy, subscription-free reads of the streamed output (askAiToFix runs
  // long after the chunks arrive; subscribing would re-render the whole panel
  // on every flush and defeat the point of the separate output atom).
  const jotaiStore = useStore();
  const chatId = useAtomValue(selectedChatIdAtom);
  const recordingState = useAtomValue(currentRecordingStateAtom);
  const requestRecording = useSetAtom(recordingStartRequestAtom);
  const { app } = useLoadApp(selectedAppId);
  const { settings, updateSettings } = useSettings();
  const { runApp } = useRunApp();
  const { setTestingEnabled, isLoading: isTogglingTesting } =
    useSetTestingEnabled();
  const { deleteTestAsync, isDeleting } = useDeleteAppTest();
  const { streamMessage, isStreaming } = useStreamChat();
  const { selectedMode } = useChatMode(chatId);
  const isAgentMode = selectedMode === "local-agent";
  const queryClient = useQueryClient();

  // "Generate test" / "Fix with AI" run in Agent mode. When the current chat is
  // in another mode, we confirm the switch first and stash the action's
  // parameters to replay on Continue. Only declarative params are stored (never
  // a callback) so Continue always runs through the latest handlers instead of
  // a closure captured when the dialog opened.
  const [agentModeDialog, setAgentModeDialog] = useState<
    | { action: "generate" }
    | {
        action: "fix";
        params: {
          file: string;
          error: string | undefined;
          testTitle?: string;
          screenshotPath?: string;
        };
      }
    | null
  >(null);
  const lastAgentModeActionRef = useRef<"generate" | "fix">("generate");

  useEffect(() => {
    if (agentModeDialog) {
      lastAgentModeActionRef.current = agentModeDialog.action;
    }
  }, [agentModeDialog]);

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
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Headed/parallel are persisted in user settings (not local state) so the
  // agent's run_tests tool honors the same choice the user makes here.
  // When enabled, runs open a visible browser window so the user can watch the
  // test drive the app, instead of running headless.
  const headed = settings?.testHeaded ?? false;
  // When enabled, a file's independent tests run concurrently instead of
  // serially (Playwright `--fully-parallel` with multiple workers).
  const parallel = settings?.testParallel ?? false;
  // When enabled, Playwright pauses between actions so the run can be followed
  // by eye — most useful alongside headed mode, where there's something to
  // watch.
  const slowMo = settings?.testSlowMo ?? false;

  const devServerRunning = appUrl.appUrl !== null;
  // Owns the run's whole lifecycle, teardown included. Gates every action that
  // must not interleave with it (Run, Record, Delete), because the per-app lock
  // is still held during `cleaning-up`.
  const isRunning = runState.phase !== "idle";
  // Narrower: tests are executing or their completed results are waiting for
  // teardown to finish. A stopped run cannot produce more results, so only
  // that cleanup path drops the per-test spinners.
  const isExecuting =
    runState.phase === "setup" ||
    runState.phase === "running" ||
    (runState.phase === "cleaning-up" && !runState.wasStopped);
  const isStopping = runState.phase === "stopping";
  const isCleaningUp = runState.phase === "cleaning-up";
  const isRestoringApp =
    isCleaningUp && runState.isolation?.mode === "neon-branch";

  // With the experiment enabled, "headed" means visible in Dyad's preview
  // rather than in a separate Playwright browser window.
  const previewRunEnabled = !!settings?.enableTestRunInPreview;
  const { data: automationStatus } = useQuery({
    queryKey: queryKeys.previewView.automationStatus,
    queryFn: () => ipc.previewView.getAutomationStatus(),
    enabled: previewRunEnabled,
    // Chromium can publish its DevTools port after the first lookup's window
    // closes. Without a retry that one unlucky poll would disable every headed
    // run — and advise a restart that fixes nothing — until this panel
    // remounts. Stop as soon as the endpoint answers; the main process caches
    // it, so these are cheap.
    refetchInterval: (query) =>
      query.state.data?.cdpReady === true ? false : 2_000,
  });
  const canRunInPreview = previewRunEnabled && !!automationStatus?.cdpReady;
  const runsInPreviewWebContentsView = canRunInPreview && headed;
  const effectiveParallel = parallel && !runsInPreviewWebContentsView;
  // The experiment only opens its CDP port at boot, so with it freshly enabled
  // there is nothing for a preview run to drive. Headed runs are routed to the
  // preview whenever the experiment is on, so EVERY entry point has to wait for
  // the restart — a per-file or Retry run that slipped through would tear down
  // the iframe preview for a native view and then dead-end on the same advice.
  //
  // Keyed on a definitive `false` rather than on `!canRunInPreview`: the status
  // query can take seconds (it polls for Chromium's port file) and can fail
  // outright, and neither is a reason to tell the user to restart — still less
  // to leave every run button dead for the rest of the session.
  const previewRestartRequired =
    previewRunEnabled && headed && automationStatus?.cdpReady === false;
  const runBlockedTitle = previewRestartRequired
    ? "Restart Dyad to run headed tests in the preview panel."
    : undefined;
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

  // Re-discover specs when a chat turn finishes - the agent may have written a
  // new spec file (via write_file), which wouldn't otherwise appear until the
  // panel is remounted. Done quietly, without the loading spinner.
  useStreamFinished(({ chatId: finishedChatId }) => {
    if (finishedChatId === chatId && selectedAppId != null) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tests.list({ appId: selectedAppId }),
      });
    }
  });

  const loadingSpecs = specsQuery.isLoading && specs.length === 0;
  const showNeonRestartDisclosure =
    specs.length > 0 &&
    !!app?.neonProjectId &&
    (settings?.runtimeMode2 ?? "host") === "host";

  // Pop the output drawer when a run starts for the app being viewed. Keyed
  // off the global atom's phase transition — not the raw IPC event — so it
  // fires for panel-initiated and agent-initiated runs alike (the latter are
  // consumed globally by useTestRunEvents). Opening on first mount makes an
  // already-running visible app transparent; app switches only update the
  // baseline, so another app's existing run doesn't rearrange this view.
  const prevRunRef = useRef<{
    appId: number | null;
    phase: (typeof runState)["phase"];
  } | null>(null);
  useEffect(() => {
    const prev = prevRunRef.current;
    if (prev === null) {
      if (selectedAppId !== null && runState.phase !== "idle") {
        setOutputOpen(true);
      }
    } else if (
      prev.appId === selectedAppId &&
      prev.phase === "idle" &&
      runState.phase !== "idle"
    ) {
      setOutputOpen(true);
    }
    prevRunRef.current = { appId: selectedAppId, phase: runState.phase };
  }, [selectedAppId, runState.phase]);

  // Run-state transitions shared with the root-level agent-run subscriber
  // (useTestRunEvents), so panel- and agent-initiated runs show the same
  // spinners/cleared-output chrome.
  const applyRunStarted = useSetAtom(applyTestRunStartedAtom);
  const applyRunFinished = useSetAtom(applyTestRunFinishedAtom);

  // One-click swap of an app's generated Supabase client off the legacy anon
  // key it was created with. Offered beside the setup warning that detected it.
  // Shares the connector card's mutation so both surfaces stay on one code path
  // and a switch here also invalidates the connector's legacy-key query.
  const switchKey = useSwitchToPublishableKey();
  // Keyed by app, and holding the isolation snapshot the switch answered, so
  // this survives the panel switching between apps: run state is retained per
  // app, and a single "which app did I just switch?" id would let a migrated
  // app's warning come back as soon as the user touched another one.
  //
  // Storing the snapshot rather than a bare flag is what keeps a FRESH run
  // authoritative: a new run produces a new isolation object, which no longer
  // matches, so its own verdict governs the button again.
  const [switchedKeyRuns, setSwitchedKeyRuns] = useState<
    ReadonlyMap<number, unknown>
  >(() => new Map());
  const keySwitched =
    selectedAppId != null &&
    runState.isolation != null &&
    switchedKeyRuns.get(selectedAppId) === runState.isolation;
  const isSwitchingKey =
    switchKey.isPending && switchKey.variables?.appId === selectedAppId;
  // Clears as soon as the user takes the fix, so the sentence claiming the key
  // is still legacy never sits next to a button that says it's been updated.
  const showLegacyKeyWarning =
    !!runState.isolation?.canSwitchToPublishableKey && !keySwitched;

  // Depends on mutateAsync, not the mutation object: useMutation returns a new
  // object every render, which would rebuild this callback each time.
  const switchKeyAsync = switchKey.mutateAsync;
  const switchedIsolation = runState.isolation;
  const switchToPublishableKey = useCallback(async () => {
    if (selectedAppId == null) return;
    const appId = selectedAppId;
    // Captured before the await: a switch resolving after the user selects
    // another app must record the run it actually answered, not whatever is
    // on screen by then.
    const isolation = switchedIsolation;
    const markSwitched = () =>
      setSwitchedKeyRuns((current) =>
        new Map(current).set(appId, isolation ?? null),
      );
    try {
      const { outcome } = await switchKeyAsync({ appId });
      // Only a real switch (or a key that was already current) may retire the
      // warning. "not-applicable" means the key is still legacy and Dyad
      // couldn't act on it, so the offer has to stay on screen.
      if (outcome === "switched") {
        markSwitched();
        showSuccess(t("integrations.supabase.apiKeyUpdated"));
      } else if (outcome === "already-current") {
        markSwitched();
        showInfo(t("integrations.supabase.apiKeyAlreadyCurrent"));
      } else {
        showInfo(t("integrations.supabase.apiKeyNotUpdated"));
      }
    } catch (error) {
      showError(error);
    }
  }, [selectedAppId, switchKeyAsync, switchedIsolation, t]);

  const runTests = useCallback(
    async (file?: string, line?: number) => {
      if (selectedAppId == null) return;
      const appId = selectedAppId;
      const isSingleTest = file != null && line != null;
      // `canRunInPreview`, not `previewRunEnabled`: the experiment only opens
      // the CDP port at boot, so with it freshly enabled there's nothing to
      // drive. Asking anyway would tear down the iframe preview for a native
      // view and then fail the run with "restart Dyad". The Run-all button is
      // disabled in that state; per-file and per-test runs reach here too.
      const preview = runsInPreviewWebContentsView;
      if (preview) {
        setPreviewNativeViewAppId(appId);
        setPreviewMode("preview");
      }
      const startedAt = Date.now();

      applyRunStarted({
        appId,
        testFile: file,
        testLine: line,
        startedAt,
        source: "panel",
      });

      try {
        const res = await ipc.tests.runAppTests({
          appId,
          testFile: file,
          testLine: line,
          headed,
          // A single targeted test can't parallelize. Preview WebContentsView
          // runs also share one browser surface, so they must stay serial.
          parallel: effectiveParallel && !isSingleTest,
          slowMo,
          preview,
        });
        applyRunFinished({
          appId,
          res,
          isPartialRun: isSingleTest,
          expectedStartedAt: startedAt,
        });
      } catch (err) {
        setRunState({
          appId,
          update: (prev) =>
            prev.startedAt === startedAt
              ? {
                  ...prev,
                  phase: "idle",
                  runningFiles: [],
                  runningTests: [],
                  runError: {
                    message: err instanceof Error ? err.message : String(err),
                    kind: "unknown",
                  },
                }
              : prev,
        });
      }
    },
    [
      selectedAppId,
      applyRunStarted,
      applyRunFinished,
      setRunState,
      headed,
      effectiveParallel,
      slowMo,
      runsInPreviewWebContentsView,
      setPreviewMode,
      setPreviewNativeViewAppId,
    ],
  );

  // Agent-initiated runs (the tests:run-state lifecycle) are consumed by the
  // root-level useTestRunEvents subscriber — NOT here — so the terminal
  // "finished" event still lands when this panel is unmounted mid-run.

  // Optimistic latch. The authoritative `stopping` phase comes back over IPC,
  // and the main process is busy streaming runner output when the user clicks,
  // so the round trip can miss a frame. The click must never look ignored.
  const [stopRequest, setStopRequest] = useState<{
    appId: number;
    startedAt?: number;
    runId?: number;
  } | null>(null);
  const stopRequestRef = useRef(stopRequest);
  const stopRequestedForActiveRun =
    stopRequest?.appId === selectedAppId &&
    stopRequest.startedAt === runState.startedAt &&
    stopRequest.runId === runState.runId;

  const stop = useCallback(() => {
    if (selectedAppId == null) return;
    const request = {
      appId: selectedAppId,
      startedAt: runState.startedAt,
      runId: runState.runId,
    };
    if (
      stopRequestRef.current?.appId === request.appId &&
      stopRequestRef.current.startedAt === request.startedAt &&
      stopRequestRef.current.runId === request.runId
    ) {
      return;
    }
    stopRequestRef.current = request;
    setStopRequest(request);
    ipc.tests.stopAppTests({ appId: selectedAppId }).catch((error) => {
      if (stopRequestRef.current === request) {
        stopRequestRef.current = null;
        setStopRequest(null);
      }
      showError(error);
    });
  }, [selectedAppId, runState.runId, runState.startedAt]);

  // The kill is under way. Covers the optimistic latch and the authoritative
  // phase, so the label survives a remount mid-stop and covers agent runs the
  // user stopped from the chat.
  const showStopping =
    isStopping || (stopRequestedForActiveRun && !isCleaningUp);

  // User-initiated: hand the failure back into an Agent-mode chat turn so the
  // agent can read the failure, fix it, and re-run it with the run_tests tool.
  const doAskAiToFix = useCallback(
    async (
      file: string,
      error: string | undefined,
      testTitle?: string,
      screenshotPath?: string,
    ) => {
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

      sections.push(
        "After making your fix, run the test with your run_tests tool and iterate until it passes.",
      );

      streamMessage({
        prompt: sections.join("\n\n"),
        chatId,
        attachments,
        requestedChatMode: "local-agent",
      });
      showInfo("Sent to chat — asking the AI to fix the test…");
    },
    [chatId, streamMessage, jotaiStore, selectedAppId],
  );

  // Public entry point: confirm the switch to Agent mode first if we aren't
  // already in it, then run the fix.
  const askAiToFix = useCallback<AskAiToFix>(
    (file, error, testTitle, screenshotPath) => {
      if (isAgentMode) {
        doAskAiToFix(file, error, testTitle, screenshotPath);
      } else {
        setAgentModeDialog({
          action: "fix",
          params: { file, error, testTitle, screenshotPath },
        });
      }
    },
    [doAskAiToFix, isAgentMode],
  );

  // Kick off a first test by asking the agent to cover a critical flow. The
  // written spec surfaces back in this panel once the turn finishes (see the
  // invalidate-on-stream-end effect above).
  const doGenerateTest = useCallback(() => {
    if (chatId == null) {
      showInfo("Open a chat to generate a test.");
      return;
    }
    streamMessage({
      prompt:
        "Generate an end-to-end test for a critical user journey in this app. First explore the app to find its most important flow, then write a single Playwright test that covers it, run it with your run_tests tool, and fix any failures until it passes.",
      chatId,
      requestedChatMode: "local-agent",
    });
    showInfo("Sent to chat — generating a test…");
  }, [chatId, streamMessage]);

  const generateTest = useCallback(() => {
    if (isAgentMode) {
      doGenerateTest();
    } else {
      setAgentModeDialog({ action: "generate" });
    }
  }, [doGenerateTest, isAgentMode]);

  // Recording happens in the preview (it drives the real app), but this panel is
  // where users look for it. Switch tabs and hand the request to the recorder,
  // which starts the session as soon as the preview mounts.
  const isRecordingSession = recordingState.phase !== "idle";
  const canStartRecording =
    devServerRunning && !isRunning && !isRecordingSession;
  const startRecording = useCallback(() => {
    if (selectedAppId == null) return;
    const currentPreviewUrl =
      previewIframeState.history[previewIframeState.position] ??
      previewIframeState.currentUrl;
    // Only a route the user picked through Dyad's chrome becomes the session's
    // opening navigation. A route the app reached on its own — a redirect, a
    // link followed before Record was pressed — is not a starting point the
    // user chose, and recording it as one makes replay `goto` straight to the
    // destination and skip the navigation that got there.
    //
    // Left undefined the recording does open at the app's root, because the
    // recorder navigates the preview there before it starts; a bare remount
    // alone would keep the app-driven route and run every captured action
    // against a page the spec's `page.goto("/")` never visits.
    const startPath =
      previewIframeState.currentUrlSource === "dyad"
        ? sameOriginStartPath(currentPreviewUrl, appUrl.appUrl)
        : undefined;
    requestRecording({
      appId: selectedAppId,
      requestedAt: Date.now(),
      startPath,
    });
    setPreviewMode("preview");
  }, [
    appUrl.appUrl,
    previewIframeState.currentUrl,
    previewIframeState.currentUrlSource,
    previewIframeState.history,
    previewIframeState.position,
    requestRecording,
    selectedAppId,
    setPreviewMode,
  ]);

  const recordButtonTitle = !devServerRunning
    ? "Start the app to record a test."
    : isRunning
      ? "Wait for the current test run to finish."
      : isRecordingSession
        ? "A recording session is already in progress."
        : "Click through your app in the preview and Dyad writes the test for you.";

  const enableTesting = useCallback(() => {
    if (selectedAppId == null) return;
    setTestingEnabled({ appId: selectedAppId, enabled: true });
  }, [selectedAppId, setTestingEnabled]);

  const disableTesting = useCallback(() => {
    if (selectedAppId == null) return;
    setOptionsOpen(false);
    setTestingEnabled({ appId: selectedAppId, enabled: false });
  }, [selectedAppId, setTestingEnabled]);

  // Swap the preview panel over to the code editor with the spec selected —
  // at the test's own line when the user opened a specific test case.
  const openInEditor = useCallback(
    (file: string, line?: number) => {
      // CodeView renders a staged-file diff in preference to the selected file,
      // so a diff left open from the commit menu would swallow this request.
      // Clearing (rather than exiting) also drops any pending commit-dialog
      // return, which would otherwise pop open over the spec.
      clearStagedDiff(selectedAppId);
      setSelectedFile({ path: file, line: line ?? null });
      setPreviewMode("code");
    },
    [setSelectedFile, setPreviewMode, clearStagedDiff, selectedAppId],
  );

  // The spec file awaiting delete confirmation, tagged with the app it came
  // from. Only data is stored (never a callback), so Delete always runs through
  // the latest handler.
  const [pendingDelete, setPendingDelete] = useState<{
    appId: number;
    file: string;
  } | null>(null);

  const confirmDelete = useCallback(async () => {
    // No deletes while a run is in flight — the backend serializes on the same
    // per-app lock, but re-check here so a run that started after the dialog
    // opened can't slip a delete through the confirmation window.
    if (pendingDelete == null || isRunning) return;
    // Delete against the app the confirmation was opened for, never whichever
    // app happens to be selected now: this panel stays mounted across app
    // switches, so the selection can have moved to a different app with a
    // same-named spec while the dialog was open.
    const { appId, file } = pendingDelete;
    if (appId !== selectedAppId) {
      setPendingDelete(null);
      return;
    }
    try {
      await deleteTestAsync({ appId, testFile: file });
    } catch {
      // Already surfaced as an error toast by the mutation; keep the panel as
      // it is so the user can retry.
      return;
    } finally {
      setPendingDelete(null);
    }
    // Drop the deleted spec's run result so a later run's counts and the
    // output drawer don't keep reporting a file that no longer exists.
    setRunState({
      appId,
      update: (prev) => {
        if (!(file in prev.results)) return prev;
        const { [file]: _removed, ...results } = prev.results;
        return { ...prev, results };
      },
    });
  }, [deleteTestAsync, isRunning, pendingDelete, selectedAppId, setRunState]);

  // If a run starts while the delete confirmation is open, close it — deleting
  // a spec out from under an in-flight run isn't allowed.
  useEffect(() => {
    if (isRunning) setPendingDelete(null);
  }, [isRunning]);

  // Switching apps invalidates the pending confirmation: the dialog names a
  // spec in the app the user just left.
  useEffect(() => {
    setPendingDelete(null);
  }, [selectedAppId]);
  const toggleOutput = useCallback(() => {
    setOutputOpen((v) => !v);
  }, []);

  // File-level status: a spinner while the file is part of an in-flight run,
  // otherwise the parsed run result (or not-run).
  const fileStatus = useCallback(
    (file: string): TestStatus => {
      if (isExecuting && runState.runningFiles.includes(file)) return "running";
      return runState.results[file]?.status ?? "not-run";
    },
    [isExecuting, runState.runningFiles, runState.results],
  );

  // Per-test status. A test spins when it's the specific test being run, or
  // when its whole file is running (no single test targeted).
  const caseStatus = useCallback(
    (file: string, testCase: TestCase): TestStatus => {
      if (isExecuting) {
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
    [
      isExecuting,
      runState.runningFiles,
      runState.runningTests,
      runState.results,
    ],
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
      <div
        className="flex items-center gap-2 px-4 py-3 border-b border-border"
        data-testid="tests-panel-header"
      >
        <FlaskConical size={18} className="text-teal-600 dark:text-teal-400" />
        <h2 className="text-base font-semibold text-foreground">Tests</h2>
        <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded">
          Experimental
        </span>
        <div className="flex-1" />
        {testingEnabled && (
          <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
            <DialogTrigger
              aria-label="Open test options"
              data-testid="tests-options-button"
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-gray-200 hover:text-foreground dark:hover:bg-gray-700"
            >
              <Settings2 size={14} />
              Options
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Test options</DialogTitle>
                <DialogDescription>
                  Choose how your tests run. These settings also apply when the
                  agent runs tests for you.
                </DialogDescription>
              </DialogHeader>

              <div className="divide-y divide-border rounded-lg border border-border">
                <div className="flex items-center justify-between gap-4 p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="test-option-parallel">
                      Run in parallel
                    </Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {runsInPreviewWebContentsView
                        ? "Unavailable while tests run in the preview panel."
                        : "Run independent tests in a file at the same time."}
                    </p>
                  </div>
                  <Switch
                    id="test-option-parallel"
                    checked={effectiveParallel}
                    disabled={isRunning || runsInPreviewWebContentsView}
                    aria-label={
                      effectiveParallel
                        ? "Switch to serial mode"
                        : "Switch to parallel mode"
                    }
                    onCheckedChange={(checked) =>
                      updateSettings({ testParallel: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-4 p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="test-option-headed">Show the browser</Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {canRunInPreview
                        ? "Watch tests run in the preview panel."
                        : "Open a browser window while tests run."}
                    </p>
                  </div>
                  <Switch
                    id="test-option-headed"
                    checked={headed}
                    disabled={isRunning}
                    aria-label={
                      headed
                        ? "Switch to headless mode"
                        : "Switch to headed mode"
                    }
                    onCheckedChange={(checked) =>
                      updateSettings({ testHeaded: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between gap-4 p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="test-option-slow-motion">Slow motion</Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Pause between actions so a visible run is easier to
                      follow.
                    </p>
                  </div>
                  <Switch
                    id="test-option-slow-motion"
                    checked={slowMo}
                    disabled={isRunning}
                    aria-label={
                      slowMo
                        ? "Switch to normal speed"
                        : "Switch to slow motion"
                    }
                    onCheckedChange={(checked) =>
                      updateSettings({ testSlowMo: checked })
                    }
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">
                    Testing for this app
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Hide the test tools until you enable them again.
                  </p>
                </div>
                <button
                  onClick={disableTesting}
                  disabled={isRunning || isTogglingTesting}
                  aria-label="Disable testing for this app"
                  className="shrink-0 rounded-md px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Disable testing
                </button>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {testingEnabled && !isRunning && (
          // The title sits on the wrapper, not the button: Chromium suppresses
          // pointer events on a disabled control, so a title there never
          // surfaces — leaving a greyed-out Record with no reason given, which
          // is exactly when the reason matters most.
          <span
            title={recordButtonTitle}
            data-testid="tests-record-button-hint"
          >
            <button
              onClick={startRecording}
              disabled={!canStartRecording}
              aria-label="Record a test in the preview"
              data-testid="tests-record-button"
              className={cn(
                "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md cursor-pointer transition-colors",
                "text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40",
                !canStartRecording && "opacity-40 cursor-not-allowed",
              )}
            >
              <CircleDot size={14} />
              Record
            </button>
          </span>
        )}
        {isRunning ? (
          // During `cleaning-up` the tests are already gone and only the
          // isolation teardown remains, so there is nothing left to stop. The
          // button reports that state instead of offering a dead action.
          <button
            onClick={stop}
            disabled={showStopping || isCleaningUp}
            aria-label={
              isCleaningUp
                ? isRestoringApp
                  ? "Restoring your app"
                  : "Cleaning up test data"
                : showStopping
                  ? "Stopping tests"
                  : "Stop running tests"
            }
            className={cn(
              "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md",
              showStopping || isCleaningUp
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 cursor-default"
                : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 cursor-pointer",
            )}
          >
            {showStopping || isCleaningUp ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Square size={14} />
            )}
            {isCleaningUp
              ? isRestoringApp
                ? "Restoring…"
                : "Cleaning up…"
              : showStopping
                ? "Stopping…"
                : "Stop"}
          </button>
        ) : (
          testingEnabled &&
          specs.length > 0 && (
            <button
              onClick={() => runTests()}
              disabled={!devServerRunning || previewRestartRequired}
              title={
                runBlockedTitle ??
                "During database-isolated runs, other app operations may wait until the run finishes."
              }
              aria-label="Run all tests"
              className={cn(
                "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md cursor-pointer",
                "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60",
                (!devServerRunning || previewRestartRequired) &&
                  "opacity-40 cursor-not-allowed",
              )}
            >
              <Play size={14} />
              Run all
            </button>
          )
        )}
      </div>

      {/* The experiment opens an unauthenticated CDP port on 127.0.0.1 for the
          whole session, not just while tests run. That is easy to enable once
          and forget, so say so where the feature is actually used rather than
          only in the Settings switch the user saw weeks ago. */}
      {canRunInPreview && (
        <div
          data-testid="tests-panel-debug-port-notice"
          className="flex items-start gap-1.5 border-b border-border/60 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-500"
        >
          <ShieldAlert size={12} className="mt-0.5 shrink-0" />
          <span>
            Debugging port open on 127.0.0.1 for this whole session. Turn off
            "Run tests in preview panel" in Settings → Experiments to close it.
          </span>
        </div>
      )}

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
                <span
                  className={cn(
                    showStopping || isCleaningUp
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-blue-600 dark:text-blue-400",
                  )}
                >
                  {isCleaningUp
                    ? // The Neon teardown restarts the dev server, so the
                      // preview visibly reloads and the copy has to account for
                      // it. The Supabase teardown only deletes the test user.
                      runState.isolation?.mode === "neon-branch"
                      ? "Restoring your database and preview… "
                      : "Cleaning up the test data… "
                    : showStopping
                      ? "Stopping the tests… "
                      : runState.phase === "setup"
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
            (runState.isolation?.reason || showLegacyKeyWarning) && (
              <div className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span className="flex-1">
                  {runState.isolation?.reason}
                  {/* Rendered here rather than folded into `reason` upstream:
                  it's the one warning the user can retire without re-running,
                  and the renderer is where it can be localized. */}
                  {showLegacyKeyWarning &&
                    (runState.isolation?.reason ? " " : "") +
                      t("integrations.supabase.legacyApiKeyTestWarning")}
                </span>
                {runState.isolation?.canSwitchToPublishableKey && (
                  <button
                    onClick={switchToPublishableKey}
                    disabled={isSwitchingKey || keySwitched}
                    className="shrink-0 px-2 py-1 rounded-md bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 disabled:opacity-60 disabled:cursor-default cursor-pointer text-xs font-medium"
                  >
                    {keySwitched
                      ? t("integrations.supabase.apiKeyUpdatedShort")
                      : isSwitchingKey
                        ? t("integrations.supabase.updatingApiKey")
                        : t("integrations.supabase.updateApiKeyShort")}
                  </button>
                )}
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
                onClick={() =>
                  runAppLifecycleInBackground("start", runApp(selectedAppId))
                }
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
                disabled={
                  isRunning || !devServerRunning || previewRestartRequired
                }
                title={runBlockedTitle}
                className={cn(
                  "shrink-0 px-2 py-1 rounded-md bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 cursor-pointer text-xs font-medium",
                  (isRunning || !devServerRunning || previewRestartRequired) &&
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
        {testingEnabled && selectedAppId != null && (
          <MigrateTestsBanner appId={selectedAppId} />
        )}
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
              data-testid="generate-test-button"
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium cursor-pointer",
                "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-900/60",
                isStreaming && "opacity-40 cursor-not-allowed",
              )}
            >
              <Sparkles size={16} />
              Generate a test for a critical user journey
            </button>
            {/* Title on the wrapper for the same reason as the toolbar's
                Record: a disabled button never fires the hover that would
                show it. */}
            <span
              title={recordButtonTitle}
              data-testid="tests-empty-record-button-hint"
              className="mt-3"
            >
              <button
                onClick={startRecording}
                disabled={!canStartRecording}
                data-testid="tests-empty-record-button"
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors",
                  "text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40",
                  !canStartRecording && "opacity-40 cursor-not-allowed",
                )}
              >
                <CircleDot size={16} />
                Or record one by clicking through your app
              </button>
            </span>
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
                disabled={
                  isRunning || !devServerRunning || previewRestartRequired
                }
                runTitle={runBlockedTitle}
                deleteDisabled={isRunning || isDeleting}
                onRunFile={() => runTests(spec.file)}
                onRunCase={(line) => runTests(spec.file, line)}
                onOpenInEditor={(line) => openInEditor(spec.file, line)}
                onDelete={() =>
                  setPendingDelete({ appId: selectedAppId, file: spec.file })
                }
                caseStatus={(testCase) => caseStatus(spec.file, testCase)}
                caseResult={(testCase) => caseResult(spec.file, testCase)}
                onAskAiToFix={askAiToFix}
              />
            ))}
          </div>
        )}
      </div>

      <OutputDrawer open={outputOpen} onToggle={toggleOutput} />

      <DeleteTestFileDialog
        file={pendingDelete?.file ?? null}
        testCount={
          specs.find((s) => s.file === pendingDelete?.file)?.tests.length ?? 0
        }
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={confirmDelete}
      />

      <AgentModeRequiredDialog
        open={agentModeDialog !== null}
        onOpenChange={(open) => {
          if (!open) setAgentModeDialog(null);
        }}
        action={agentModeDialog?.action ?? lastAgentModeActionRef.current}
        onContinue={() => {
          if (agentModeDialog?.action === "fix") {
            const { file, error, testTitle, screenshotPath } =
              agentModeDialog.params;
            doAskAiToFix(file, error, testTitle, screenshotPath);
          } else if (agentModeDialog) {
            doGenerateTest();
          }
          setAgentModeDialog(null);
        }}
      />
    </div>
  );
}

/**
 * Confirmation for deleting a spec file. Deleting removes the file from disk
 * and commits that deletion (so it's recoverable from version history), which
 * is worth a confirm — especially since the row also carries the count of
 * tests that go with it.
 */
function DeleteTestFileDialog({
  file,
  testCount,
  onOpenChange,
  onConfirm,
}: {
  file: string | null;
  testCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const fileName = file ? (file.split("/").pop() ?? file) : "";
  return (
    <AlertDialog open={file !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="delete-test-file-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {fileName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {testCount > 0
              ? `This deletes the file and the ${testCount} ${
                  testCount === 1 ? "test" : "tests"
                } in it. `
              : "This deletes the test file. "}
            If it's tracked in git, the deletion is committed on its own so you
            can restore it from version history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            data-testid="confirm-delete-test-file"
            className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:text-white dark:hover:bg-red-700"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
