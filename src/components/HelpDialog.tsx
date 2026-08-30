import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  BookOpenIcon,
  BugIcon,
  UploadIcon,
  ChevronLeftIcon,
  CheckIcon,
  XIcon,
  SparklesIcon,
  Github,
  AlertCircleIcon,
  MessageSquareIcon,
  CopyIcon,
  Loader2Icon,
} from "lucide-react";
import { ipc } from "@/ipc/types";
import {
  type ReactNode,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useAtom, useAtomValue } from "jotai";
import { usePostHog } from "posthog-js/react";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { helpDialogAtom } from "@/atoms/helpDialogAtom";
import { type SessionDebugBundle } from "@/ipc/types";
import { showError, showInfo } from "@/lib/toast";
import { useTranslation } from "react-i18next";
import { HelpBotDialog } from "./HelpBotDialog";
import { useSettings } from "@/hooks/useSettings";
import {
  BugScreenshotDialog,
  promptSourceForKind,
  type PendingReport,
  type ScreenshotPromptSource,
} from "./BugScreenshotDialog";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { motion, AnimatePresence } from "framer-motion";
import { useChatMode } from "@/hooks/useChatMode";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import { createModelSelection, getModelPreferenceKey } from "@/lib/modelEffort";
import {
  EMPTY_REPORT_FIELDS,
  buildBugReportBody,
  buildBugReportFallbackBody,
  buildIssueUrl,
  buildSessionReportBody,
  buildSessionReportFallbackBody,
  formatDiagnosticsSections,
  formatIssueTitle,
  type ReportFields,
  type ScreenshotOutcome,
} from "@/lib/issueBody";
import {
  IssueForm,
  NO_CAP_HIT,
  type CapState,
  type ReportKind,
} from "./IssueForm";
import { type SystemDebugInfo } from "@/ipc/types";

// =============================================================================
// Animation constants
// =============================================================================

type DialogScreen = "main" | "review" | "upload-complete" | "form";

// Positional: the slide direction is read off these indices. The form is the
// last stop in both flows -- straight from main for a bug report, and after
// the upload for a session report.
const SCREEN_ORDER: DialogScreen[] = [
  "main",
  "review",
  "upload-complete",
  "form",
];

const screenVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction < 0 ? 80 : -80,
    opacity: 0,
  }),
};

const screenTransition = {
  x: { type: "spring" as const, stiffness: 400, damping: 35 },
  opacity: { duration: 0.15 },
};

// =============================================================================
// GitHub issue helpers (shared between Report a Bug & Upload Chat Session)
// =============================================================================

function openGitHubIssue(params: {
  title: string;
  labels: string[];
  body: string;
  isDyadProUser: unknown;
}) {
  const labels = [...params.labels];
  if (params.isDyadProUser) labels.push("pro");
  ipc.system.openExternalUrl(
    buildIssueUrl({ title: params.title, labels, body: params.body }),
  );
}

// =============================================================================
// Reusable sub-components
// =============================================================================

/** Animated wrapper applied to every dialog screen. */
function AnimatedScreen({
  screenKey,
  direction,
  skipInitial,
  className,
  children,
}: {
  screenKey: string;
  direction: number;
  skipInitial?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      key={screenKey}
      custom={direction}
      variants={screenVariants}
      initial={skipInitial ? false : "enter"}
      animate="center"
      exit="exit"
      transition={screenTransition}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** A collapsible section in the review screen. */
function ReviewDetailsSection({
  title,
  children,
  mono,
  data,
}: {
  title: string;
  children?: ReactNode;
  mono?: boolean;
  data?: unknown;
}) {
  return (
    <details className="border rounded-md p-3">
      <summary className="font-medium cursor-pointer">{title}</summary>
      <div
        className={`text-sm bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-40 overflow-y-auto mt-2 ${mono !== false ? "font-mono" : ""} whitespace-pre-wrap`}
      >
        {data !== undefined ? JSON.stringify(data, null, 2) : children}
      </div>
    </details>
  );
}

/** Copy button with animated feedback. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const posthog = usePostHog();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      // Reported so we can see copies that land after a screenshot capture and
      // overwrite the image the reporter was about to paste.
      posthog.capture("session-report:copy-session-id");
      setCopied(true);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [text, posthog]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      onClick={handleCopy}
      className="shrink-0 p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
      aria-label="Copy session ID"
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.div
            key="check"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <CheckIcon className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          </motion.div>
        ) : (
          <motion.div
            key="copy"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <CopyIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

// =============================================================================
// Main component
// =============================================================================

export function HelpDialog() {
  const { t } = useTranslation(["home", "common"]);
  const [helpDialog, setHelpDialog] = useAtom(helpDialogAtom);
  const isOpen = helpDialog.open;
  const onClose = () => setHelpDialog({ open: false });
  const [isUploading, setIsUploading] = useState(false);
  const [screen, setScreen] = useState<DialogScreen>("main");
  const [direction, setDirection] = useState(0);
  const [debugBundle, setDebugBundle] = useState<SessionDebugBundle | null>(
    null,
  );
  const [sessionId, setSessionId] = useState("");
  const [isHelpBotOpen, setIsHelpBotOpen] = useState(false);
  const [isScreenshotPromptOpen, setIsScreenshotPromptOpen] = useState(false);
  const [promptSource, setPromptSource] =
    useState<ScreenshotPromptSource>("report-bug");
  // What the screenshot prompt should file once the reporter answers it.
  // Opening the prompt closes this dialog, which runs resetDialogState, so the
  // session ID is snapshotted here rather than read back from state later.
  const [pendingReport, setPendingReport] = useState<PendingReport | null>(
    null,
  );
  // The form's draft. Held here rather than in the report, because the report
  // is only assembled once the reporter leaves the form for the screenshot.
  const [reportKind, setReportKind] = useState<ReportKind | null>(null);
  const [fields, setFields] = useState<ReportFields>(EMPTY_REPORT_FIELDS);
  const [atCap, setAtCap] = useState<CapState>(NO_CAP_HIT);
  // Shown in the form's diagnostics disclosure. The body is still built from a
  // fresh read at submit time, so what ships is never staler than the report.
  const [formDebugInfo, setFormDebugInfo] = useState<SystemDebugInfo | null>(
    null,
  );
  const [formDebugInfoFailed, setFormDebugInfoFailed] = useState(false);
  const hasNavigated = useRef(false);
  // Tracks which chat (if any) we've already preloaded for the crash-triggered
  // upload flow, so the preload effect fires once per open.
  const preloadedChatId = useRef<number | null>(null);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { settings } = useSettings();
  const { chat: selectedChat } = useChatMode(selectedChatId);
  const { data: modelsByProviders } = useLanguageModelsByProviders();
  const defaultCatalogModel = settings
    ? modelsByProviders?.[settings.selectedModel.provider]?.find((model) =>
        settings.selectedModel.customModelId
          ? model.type === "custom" &&
            model.id === settings.selectedModel.customModelId
          : model.apiName === settings.selectedModel.name,
      )
    : undefined;
  const diagnosticModelSelection = settings
    ? (selectedChat?.modelSelection ??
      createModelSelection({
        model: settings.selectedModel,
        catalogModel: defaultCatalogModel,
        preferredEffortLevel:
          settings.modelEffortPreferences?.[
            getModelPreferenceKey(settings.selectedModel)
          ],
      }))
    : null;
  const { userBudget } = useUserBudgetInfo();
  const posthog = usePostHog();
  const isDyadProUser = settings?.providerSettings?.["auto"]?.apiKey?.value;

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const navigateTo = (newScreen: DialogScreen) => {
    const currentIdx = SCREEN_ORDER.indexOf(screen);
    const newIdx = SCREEN_ORDER.indexOf(newScreen);
    setDirection(newIdx > currentIdx ? 1 : -1);
    setScreen(newScreen);
    hasNavigated.current = true;
  };

  const resetDialogState = () => {
    setIsUploading(false);
    setScreen("main");
    setDirection(0);
    setDebugBundle(null);
    setSessionId("");
    setReportKind(null);
    setFields(EMPTY_REPORT_FIELDS);
    setAtCap(NO_CAP_HIT);
    setFormDebugInfo(null);
    setFormDebugInfoFailed(false);
    hasNavigated.current = false;
    preloadedChatId.current = null;
  };

  // Holds this dialog's state while a report waits on the screenshot prompt,
  // so backing out of the prompt lands the reporter where they were.
  useEffect(() => {
    if (!isOpen && !pendingReport && !reportKind) resetDialogState();
  }, [isOpen, pendingReport, reportKind]);

  // The draft survives a closed dialog, but this guard must not: it exists to
  // keep the preload to once per opening, and a second force-close on the same
  // chat has to preload again. resetDialogState would clear it, except a live
  // draft is exactly the case that suppresses that reset.
  useEffect(() => {
    if (!isOpen) preloadedChatId.current = null;
  }, [isOpen]);

  // Loaded when the form opens so the disclosure can show what will be
  // attached before the reporter commits to sending it.
  useEffect(() => {
    if (screen !== "form" || formDebugInfo || formDebugInfoFailed) return;
    let active = true;
    ipc.system
      .getSystemDebugInfo()
      .then((info) => {
        if (active) setFormDebugInfo(info);
      })
      .catch((error) => {
        // The disclosure says so rather than sitting on a spinner. The report
        // itself has its own fallback path if the same call fails at submit.
        console.error("Failed to load diagnostics preview:", error);
        if (active) setFormDebugInfoFailed(true);
      });
    return () => {
      active = false;
    };
  }, [screen, formDebugInfo, formDebugInfoFailed]);

  // A dispatched report releases the draft, which leaves the form with nothing
  // to render. Only relevant while the dialog is on screen: a closed dialog is
  // reset wholesale above, and correcting it here would fight that reset.
  useEffect(() => {
    if (isOpen && screen === "form" && !reportKind) {
      setScreen(sessionId ? "upload-complete" : "main");
    }
  }, [isOpen, screen, reportKind, sessionId]);

  // Crash-triggered upload: when opened with a uploadChatId, skip the main
  // screen, preload that chat's debug bundle, and jump straight to review.
  useEffect(() => {
    if (!isOpen) return;
    const chatId = helpDialog.uploadChatId;
    if (chatId == null || preloadedChatId.current === chatId) return;
    preloadedChatId.current = chatId;
    // The crash upload is a new report and takes the dialog over, so the
    // suspended draft goes with it. Left in place it would keep
    // resetDialogState suppressed for the rest of the session.
    setReportKind(null);
    setFields(EMPTY_REPORT_FIELDS);
    setAtCap(NO_CAP_HIT);
    setIsUploading(true);
    // Guard against the dialog closing before the bundle resolves, which would
    // otherwise leave it on the review screen with a stale bundle.
    let active = true;
    ipc.misc
      .getSessionDebugBundle(chatId)
      .then((bundle) => {
        if (!active) return;
        setDebugBundle(bundle);
        // Clear uploadChatId once loaded so canceling from review back to the
        // main screen doesn't keep rendering the preload spinner.
        setHelpDialog({ open: true });
        // Move to review with an explicit forward direction. The preload only
        // runs from the main screen, so we set the transition directly rather
        // than reading the screen value asynchronously via navigateTo.
        setDirection(1);
        setScreen("review");
        hasNavigated.current = true;
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load chat session:", error);
        showError(t("home:help.failedToLoadChatSession"));
        onClose();
      })
      .finally(() => {
        if (active) setIsUploading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, helpDialog.uploadChatId]);

  const handleClose = () => onClose();

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleReportBug = async (
    screenshot: ScreenshotOutcome,
    reportedFields: ReportFields,
  ) => {
    showInfo("Preparing your bug report...");
    const title = formatIssueTitle("bug", reportedFields.title);
    try {
      const debugInfo = await ipc.system.getSystemDebugInfo();
      const body = buildBugReportBody({
        debugInfo,
        settings,
        selectedModel: diagnosticModelSelection,
        userBudget: userBudget ?? undefined,
        screenshot,
        fields: reportedFields,
      });
      openGitHubIssue({
        title,
        labels: ["bug"],
        body,
        isDyadProUser,
      });
    } catch (error) {
      console.error("Failed to prepare bug report:", error);
      openGitHubIssue({
        title,
        labels: ["bug"],
        body: buildBugReportFallbackBody({
          screenshot,
          fields: reportedFields,
        }),
        isDyadProUser,
      });
    }
  };

  const handleUploadChatSession = async () => {
    if (!selectedChatId) {
      alert("Please select a chat first");
      return;
    }
    setIsUploading(true);
    try {
      const bundle = await ipc.misc.getSessionDebugBundle(selectedChatId);
      setDebugBundle(bundle);
      navigateTo("review");
    } catch (error) {
      console.error("Failed to upload chat session:", error);
      alert(
        "Failed to upload chat session. Please try again or report manually.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmitChatLogs = async () => {
    if (!debugBundle) return;
    setIsUploading(true);
    try {
      const response = await fetch(
        "https://upload-logs.dyad.sh/generate-upload-url",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            extension: "json",
            contentType: "application/json",
          }),
        },
      );
      if (!response.ok) {
        showError(`Failed to get upload URL: ${response.statusText}`);
        throw new Error(`Failed to get upload URL: ${response.statusText}`);
      }
      const { uploadUrl, filename } = await response.json();
      await ipc.system.uploadToSignedUrl({
        url: uploadUrl,
        contentType: "application/json",
        data: debugBundle,
      });
      setSessionId("v2:" + filename.replace(".json", ""));
      navigateTo("upload-complete");
    } catch (error) {
      console.error("Failed to upload chat logs:", error);
      alert("Failed to upload chat logs. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancelReview = () => {
    navigateTo("main");
    setDebugBundle(null);
  };

  // reportedSessionId is passed in rather than read from state: the screenshot
  // prompt closes this dialog before this runs, which clears sessionId.
  const handleOpenGitHubIssue = async (
    screenshot: ScreenshotOutcome,
    reportedSessionId: string,
    reportedFields: ReportFields,
  ) => {
    showInfo("Preparing your session report...");
    const title = formatIssueTitle("session", reportedFields.title);
    try {
      const debugInfo = await ipc.system.getSystemDebugInfo();
      openGitHubIssue({
        title,
        labels: ["support"],
        body: buildSessionReportBody({
          debugInfo,
          settings,
          selectedModel: diagnosticModelSelection,
          userBudget: userBudget ?? undefined,
          screenshot,
          fields: reportedFields,
          sessionId: reportedSessionId,
        }),
        isDyadProUser,
      });
    } catch (error) {
      console.error("Failed to prepare session report:", error);
      openGitHubIssue({
        title,
        labels: ["support"],
        body: buildSessionReportFallbackBody({
          userBudget: userBudget ?? undefined,
          screenshot,
          fields: reportedFields,
          sessionId: reportedSessionId,
        }),
        isDyadProUser,
      });
    }
  };

  // Both report paths funnel through the form and then the screenshot prompt,
  // so the issue body always records whether a screenshot was taken.
  const startReport = (kind: ReportKind) => {
    // Emitted here rather than on the form's mount, which also runs when the
    // reporter reopens a suspended draft: this is the denominator the blocked
    // count is read against, so it has to be one per report started.
    posthog.capture("issue-form:opened", {
      source: promptSourceForKind(kind),
    });
    // A second report replaces the first: reaching this while one is in flight
    // takes a click during the sub-second window where no dialog is on screen.
    setReportKind(kind);
    setFields(EMPTY_REPORT_FIELDS);
    setAtCap(NO_CAP_HIT);
    navigateTo("form");
  };

  const handleFormBack = () => {
    setReportKind(null);
    setFields(EMPTY_REPORT_FIELDS);
    setAtCap(NO_CAP_HIT);
    navigateTo(sessionId ? "upload-complete" : "main");
  };

  // The fields travel with the report from here, so the dispatch that runs
  // after the prompt is answered never reads them back out of this dialog.
  const handleFormContinue = () => {
    if (!reportKind) return;
    openScreenshotPrompt(
      reportKind === "session"
        ? { kind: "session", sessionId, fields }
        : { kind: "bug", fields },
    );
  };

  const openScreenshotPrompt = (report: PendingReport) => {
    // Held separately from pendingReport, which is released as soon as the
    // report is dispatched, while the prompt is still animating out.
    setPromptSource(promptSourceForKind(report.kind));
    setPendingReport(report);
    handleClose();
    setIsScreenshotPromptOpen(true);
  };

  const handleScreenshotPromptContinue = (
    screenshot: ScreenshotOutcome,
    report: PendingReport,
  ) => {
    // The report carries its own screenshot outcome and session ID, so it
    // needs nothing from this dialog once it starts. Release only this report,
    // so a later one is never cleared out from under itself.
    const ownsDraft = pendingReport === report;
    setPendingReport((current) => (current === report ? null : current));
    // Releases the draft too, since the report carries everything it needs.
    // Guarded the same way as pendingReport above: a report that finishes
    // after a newer one started must not clear the newer one's draft.
    if (ownsDraft) {
      setReportKind(null);
      setFields(EMPTY_REPORT_FIELDS);
      setAtCap(NO_CAP_HIT);
    }
    if (report.kind === "session") {
      void handleOpenGitHubIssue(screenshot, report.sessionId, report.fields);
    } else {
      void handleReportBug(screenshot, report.fields);
    }
  };

  // A prompt on screen belongs to a newer report, so an abandoned capture
  // leaves it in place rather than closing it.
  const handleCaptureAbandon = () => {
    if (isScreenshotPromptOpen) return;
    setPendingReport(null);
    setHelpDialog({ open: true });
  };

  // The prompt is a stop on the way to the issue, not a place to lose an
  // upload: backing out of it reopens the help dialog as the reporter left it.
  const handleScreenshotPromptDismiss = () => {
    setIsScreenshotPromptOpen(false);
    setPendingReport(null);
    setHelpDialog({ open: true });
  };

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  const renderMainScreen = () => (
    <AnimatedScreen
      screenKey="main"
      direction={direction}
      skipInitial={!hasNavigated.current}
    >
      <DialogHeader>
        <DialogTitle>Need help with Dyad?</DialogTitle>
      </DialogHeader>
      <DialogDescription>
        If you need help or want to report an issue, here are some options:
      </DialogDescription>
      <div className="flex flex-col w-full mt-4 space-y-5">
        {/* Self-service help */}
        {isDyadProUser ? (
          <Button
            variant="default"
            onClick={() => setIsHelpBotOpen(true)}
            className="w-full py-6 border-primary/50 shadow-sm shadow-primary/10 transition-all hover:shadow-md hover:shadow-primary/15"
          >
            <SparklesIcon className="mr-2 h-5 w-5" /> Chat with Dyad help bot
            (Pro)
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() =>
              ipc.system.openExternalUrl("https://www.dyad.sh/docs")
            }
            className="w-full py-6 bg-(--background-lightest)"
          >
            <BookOpenIcon className="mr-2 h-5 w-5" /> Open Docs
          </Button>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Report an issue
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Report options */}
        <div className="grid grid-cols-1 gap-3">
          {/* Upload Chat Session */}
          <div className="border rounded-lg p-4 space-y-3 relative">
            <div className="flex items-center gap-2">
              <MessageSquareIcon className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">
                AI / Dyad Pro issues
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Best for AI quality issues. Uploads your chat session and code for
              the team to reproduce and fix the problem.
            </p>
            <Button
              variant="outline"
              onClick={handleUploadChatSession}
              disabled={isUploading || !selectedChatId}
              className="w-full bg-(--background-lightest)"
            >
              <UploadIcon className="mr-2 h-4 w-4" />{" "}
              {isUploading ? "Preparing Upload..." : "Upload Chat Session"}
            </Button>
            {!selectedChatId && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertCircleIcon className="h-3 w-3 shrink-0" />
                Open a chat first to upload a session.
              </p>
            )}
          </div>

          {/* Report a Bug */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <BugIcon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Non-AI issues</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Includes error logs to troubleshoot non-AI issues with Dyad (UI
              bugs, crashes, setup problems, etc.).
            </p>
            <Button
              variant="outline"
              onClick={() => startReport("bug")}
              className="w-full bg-(--background-lightest)"
            >
              <BugIcon className="mr-2 h-4 w-4" /> Report a Bug
            </Button>
          </div>
        </div>
      </div>
    </AnimatedScreen>
  );

  const renderReviewScreen = () =>
    debugBundle && (
      <AnimatedScreen
        screenKey="review"
        direction={direction}
        className="flex flex-col overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Button
              variant="ghost"
              className="mr-2 p-0 h-8 w-8"
              onClick={handleCancelReview}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            OK to upload chat session?
          </DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Please review the information that will be submitted. Your chat
          messages, system information, and a snapshot of your codebase will be
          included.
        </DialogDescription>

        <div className="space-y-2 overflow-y-auto flex-grow mt-4">
          <ReviewDetailsSection title="Chat Messages" mono={false}>
            {debugBundle.chat.messages.map((msg) => (
              <div key={msg.id} className="mb-2">
                <span className="font-semibold">
                  {msg.role === "user" ? "You" : "Assistant"}:{" "}
                </span>
                <span>{msg.content}</span>
              </div>
            ))}
          </ReviewDetailsSection>

          <ReviewDetailsSection title="Codebase Snapshot">
            {debugBundle.codebase}
          </ReviewDetailsSection>

          <ReviewDetailsSection title="Logs">
            {debugBundle.logs}
          </ReviewDetailsSection>

          {debugBundle.updaterLogs && (
            <ReviewDetailsSection title="Auto-Updater Logs">
              {debugBundle.updaterLogs}
            </ReviewDetailsSection>
          )}

          <ReviewDetailsSection title="System Information" mono={false}>
            <p>Dyad Version: {debugBundle.system.dyadVersion}</p>
            <p>Platform: {debugBundle.system.platform}</p>
            <p>Architecture: {debugBundle.system.architecture}</p>
            <p>
              Node Version: {debugBundle.system.nodeVersion || "Not available"}
            </p>
          </ReviewDetailsSection>

          <ReviewDetailsSection title="Settings" data={debugBundle.settings} />
          <ReviewDetailsSection title="App Metadata" data={debugBundle.app} />
          <ReviewDetailsSection
            title="Custom Providers & Models"
            data={debugBundle.providers}
          />
          <ReviewDetailsSection
            title="MCP Servers"
            data={debugBundle.mcpServers}
          />
          {debugBundle.memoryDiagnostics && (
            <ReviewDetailsSection
              title="Memory Diagnostics"
              data={debugBundle.memoryDiagnostics}
            />
          )}
        </div>

        <div className="flex justify-between mt-4 pt-2 sticky bottom-0 bg-background">
          <Button
            variant="outline"
            onClick={handleCancelReview}
            className="flex items-center"
          >
            <XIcon className="mr-2 h-4 w-4" /> Cancel
          </Button>
          <Button
            onClick={handleSubmitChatLogs}
            className="flex items-center"
            disabled={isUploading}
          >
            {isUploading ? (
              "Uploading..."
            ) : (
              <>
                <CheckIcon className="mr-2 h-4 w-4" /> Upload
              </>
            )}
          </Button>
        </div>
      </AnimatedScreen>
    );

  const renderUploadCompleteScreen = () => (
    <AnimatedScreen screenKey="upload-complete" direction={direction}>
      <DialogHeader>
        <DialogTitle>Upload Complete</DialogTitle>
      </DialogHeader>

      <div className="flex items-center gap-2.5 mt-3">
        <CheckIcon className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
        <span className="text-base font-medium">Chat session uploaded</span>
      </div>

      <div className="bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded-md flex items-center gap-2 font-mono text-sm mt-2">
        <span className="truncate flex-1 select-all">{sessionId}</span>
        <CopyButton text={sessionId} />
      </div>

      <Button
        onClick={() => startReport("session")}
        className="w-full py-5 text-base mt-4"
        size="lg"
      >
        <Github className="mr-2 h-5 w-5" />
        Create GitHub Issue
      </Button>

      <div className="border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 mt-3">
        <div className="flex items-start gap-2">
          <AlertCircleIcon className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700 dark:text-amber-400/80">
            Your upload will not be reviewed without a linked GitHub issue. The
            issue will be pre-filled with your session ID and system info.
          </p>
        </div>
      </div>
    </AnimatedScreen>
  );

  const renderFormScreen = () =>
    reportKind && (
      <AnimatedScreen
        screenKey="form"
        direction={direction}
        className="flex flex-col overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>
            {reportKind === "bug" ? "Report a bug" : "Describe the issue"}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Filling this in here means the GitHub issue arrives ready to read.
        </DialogDescription>

        {/* Padded on every side, not just the right: the scroll container
            clips overflow, and the inputs draw a focus ring up to 4px outside
            their box that would otherwise be cut off. */}
        <div className="overflow-y-auto flex-grow mt-4 p-1.5">
          <IssueForm
            kind={reportKind}
            fields={fields}
            onChange={setFields}
            atCap={atCap}
            onAtCapChange={setAtCap}
            onBack={handleFormBack}
            onContinue={handleFormContinue}
            diagnostics={
              <ReviewDetailsSection title="Diagnostics we'll include">
                {formDebugInfo ? (
                  // The body's own text, not a summary of it: anything added
                  // to the report shows up here without a second edit.
                  formatDiagnosticsSections({
                    debugInfo: formDebugInfo,
                    settings,
                    selectedModel: diagnosticModelSelection,
                    userBudget: userBudget ?? undefined,
                  })
                ) : formDebugInfoFailed ? (
                  <span className="font-sans">
                    Diagnostics could not be read. Your report will still be
                    filed, with whatever we can gather at that point.
                  </span>
                ) : (
                  <span className="font-sans">Loading diagnostics...</span>
                )}
              </ReviewDetailsSection>
            }
          />
        </div>
      </AnimatedScreen>
    );

  // Shown while a crash-triggered upload preloads its bundle, so the user who
  // clicked "Upload Chat Session" sees a spinner instead of the main help menu
  // before the review screen appears.
  const renderPreloadingScreen = () => (
    <AnimatedScreen
      screenKey="main"
      direction={direction}
      skipInitial={!hasNavigated.current}
    >
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
        <Loader2Icon className="h-6 w-6 animate-spin" />
        <span>{t("home:help.preparingUpload")}</span>
        <Button variant="outline" size="sm" onClick={handleClose}>
          {t("common:cancel")}
        </Button>
      </div>
    </AnimatedScreen>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isCrashPreloading = helpDialog.uploadChatId != null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent
          className={
            screen === "review"
              ? "max-w-4xl max-h-[80vh] overflow-hidden flex flex-col"
              : screen === "form"
                ? "max-h-[80vh] overflow-hidden flex flex-col"
                : undefined
          }
        >
          <AnimatePresence mode="wait" custom={direction}>
            {isCrashPreloading && renderPreloadingScreen()}
            {!isCrashPreloading && screen === "main" && renderMainScreen()}
            {!isCrashPreloading && screen === "review" && renderReviewScreen()}
            {!isCrashPreloading &&
              screen === "upload-complete" &&
              renderUploadCompleteScreen()}
            {!isCrashPreloading && screen === "form" && renderFormScreen()}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
      <HelpBotDialog
        isOpen={isHelpBotOpen}
        onClose={() => setIsHelpBotOpen(false)}
      />
      <BugScreenshotDialog
        isOpen={isScreenshotPromptOpen}
        onClose={() => setIsScreenshotPromptOpen(false)}
        onDismiss={handleScreenshotPromptDismiss}
        onCaptureAbandon={handleCaptureAbandon}
        onContinue={handleScreenshotPromptContinue}
        source={promptSource}
        report={pendingReport}
      />
    </>
  );
}
