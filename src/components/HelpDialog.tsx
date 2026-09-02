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
  ChevronLeftIcon,
  SparklesIcon,
} from "lucide-react";
import { ipc } from "@/ipc/types";
import { type ReactNode, useState, useEffect, useRef } from "react";
import { useAtom, useAtomValue } from "jotai";
import { usePostHog } from "posthog-js/react";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { helpDialogAtom } from "@/atoms/helpDialogAtom";
import { type SessionDebugBundle, type SystemDebugInfo } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { SCREENSHOT_ERRORS } from "@/ipc/types/system";
import { useTranslation } from "react-i18next";
import { HelpBotDialog } from "./HelpBotDialog";
import { useSettings } from "@/hooks/useSettings";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { motion, AnimatePresence } from "framer-motion";
import { useChatMode } from "@/hooks/useChatMode";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import { createModelSelection, getModelPreferenceKey } from "@/lib/modelEffort";
import {
  ISSUE_TITLE,
  buildIssueBody,
  buildIssueUrl,
  formatDiagnosticsSections,
  type Diagnostics,
  type ScreenshotOutcome,
} from "@/lib/issueBody";
import { IssueForm } from "./IssueForm";
import { ScreenshotField } from "./ScreenshotField";
import { ReportDisclosures } from "./ReportDisclosures";

const UPLOAD_URL_ENDPOINT = "https://upload-logs.dyad.sh/generate-upload-url";

type DialogScreen = "main" | "form";

/** Which entry point a report came from, carried on every event it emits. */
type ReportSource = "report-bug" | "force-close";

/** How long a submit waits on a diagnostics read that has not landed yet. */
const DIAGNOSTICS_SUBMIT_WAIT_MS = 3_000;

/** Everything needed to file, snapshotted when the reporter submits. */
interface OutgoingReport {
  description: string;
  screenshot: ScreenshotOutcome;
  includeSystemInfo: boolean;
  includeSession: boolean;
  chatId: number | null;
  bundle: SessionDebugBundle | null;
  /** Names this report's own capture, so another report's cannot be pasted. */
  captureId: string | null;
  /** What the disclosure showed. Null if it had not loaded yet. */
  debugInfo: SystemDebugInfo | null;
}

/**
 * Known capture failures, reported instead of the raw message so the event
 * carries a fixed set of values.
 */
function classifyCaptureFailure(reason: string): string {
  if (reason.includes(SCREENSHOT_ERRORS.noFocusedWindow)) {
    return "no-focused-window";
  }
  if (reason.includes(SCREENSHOT_ERRORS.emptyImage)) return "empty-image";
  return "other";
}

const SCREEN_ORDER: DialogScreen[] = ["main", "form"];

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

function openGitHubIssue(params: { body: string; isDyadProUser: unknown }) {
  const labels = ["bug"];
  if (params.isDyadProUser) labels.push("pro");
  ipc.system.openExternalUrl(
    buildIssueUrl({ title: ISSUE_TITLE, labels, body: params.body }),
  );
}

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

export function HelpDialog() {
  const { t } = useTranslation(["home", "common"]);
  const [helpDialog, setHelpDialog] = useAtom(helpDialogAtom);
  const isOpen = helpDialog.open;
  const onClose = () => setHelpDialog({ open: false });

  const [screen, setScreen] = useState<DialogScreen>("main");
  const [direction, setDirection] = useState(0);
  const [isHelpBotOpen, setIsHelpBotOpen] = useState(false);

  // The report being written. `reportOpen` keeps the draft alive while the
  // dialog is closed for a screenshot.
  const [reportOpen, setReportOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [atCap, setAtCap] = useState(false);
  const [includeSystemInfo, setIncludeSystemInfo] = useState(true);
  const [includeSession, setIncludeSession] = useState(true);

  // Shown in the disclosures, and sent as-is: the reporter agrees to what
  // they can see. The one exception is a submit that beats the read -- see
  // fileReport, which waits briefly rather than call the machine
  // undiagnosable, and so can send a snapshot that was never on screen.
  const [formDebugInfo, setFormDebugInfo] = useState<SystemDebugInfo | null>(
    null,
  );
  const [formDebugInfoFailed, setFormDebugInfoFailed] = useState(false);
  // Bumped to ask for another read. The form opening is not enough on its own:
  // a crash report can start while the form is already up.
  const [diagnosticsRun, setDiagnosticsRun] = useState(0);
  const [debugBundle, setDebugBundle] = useState<SessionDebugBundle | null>(
    null,
  );
  const [bundleLoading, setBundleLoading] = useState(false);

  const [screenshot, setScreenshot] = useState<ScreenshotOutcome | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(
    null,
  );
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isFiling, setIsFiling] = useState(false);
  // Fixed when the report starts. Reading it from the dialog atom would let it
  // change under the reporter, because closing the dialog for a capture drops
  // the crash-triggered chat id.
  const [sessionChatId, setSessionChatId] = useState<number | null>(null);

  const hasNavigated = useRef(false);
  // Identifies the draft a capture was started for. A capture that lands after
  // the draft was replaced belongs to a report that no longer exists.
  const captureToken = useRef(0);
  // One issue-form:blocked per report, so it can be read against
  // issue-form:opened. The form itself unmounts during a capture, so a guard
  // inside it would reset too often.
  const blockedReported = useRef(false);
  const preloadedChatId = useRef<number | null>(null);
  // The upload in flight, so backing out can stop it sending.
  const activeUpload = useRef<string | null>(null);
  // The session read in flight. Submitting before it lands must join it
  // rather than start a second one, or the disclosure and the upload end up
  // showing and sending different snapshots.
  const sessionRequest = useRef<Promise<SessionDebugBundle> | null>(null);
  // The diagnostics read in flight, for the same reason as the session one.
  const diagnosticsRequest = useRef<Promise<SystemDebugInfo> | null>(null);
  // Mirrors captureId. Teardown runs from effects, where the state a closure
  // captured may already be a render behind.
  const activeCapture = useRef<string | null>(null);
  // Where this report came from. A ref because the screenshot events fire from
  // callbacks that outlive the render which started the report.
  const reportSource = useRef<ReportSource>("report-bug");

  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { settings } = useSettings();
  // Once a report has a chat, that is the one described: a draft outlives a
  // chat switch, and a crash report names a chat of its own.
  const { chat: reportChat } = useChatMode(sessionChatId ?? selectedChatId);
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
    ? (reportChat?.modelSelection ??
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
  // Navigation and lifecycle
  // ---------------------------------------------------------------------------

  const navigateTo = (newScreen: DialogScreen) => {
    const currentIdx = SCREEN_ORDER.indexOf(screen);
    const newIdx = SCREEN_ORDER.indexOf(newScreen);
    setDirection(newIdx > currentIdx ? 1 : -1);
    setScreen(newScreen);
    hasNavigated.current = true;
  };

  const resetDialogState = () => {
    setScreen("main");
    setDirection(0);
    setReportOpen(false);
    setDescription("");
    setAtCap(false);
    setIncludeSystemInfo(true);
    setIncludeSession(true);
    setFormDebugInfo(null);
    setFormDebugInfoFailed(false);
    setDebugBundle(null);
    setBundleLoading(false);
    setScreenshot(null);
    setScreenshotPreview(null);
    setCaptureId(null);
    setIsCapturing(false);
    setIsFiling(false);
    setSessionChatId(null);
    cancelReport();
    hasNavigated.current = false;
    preloadedChatId.current = null;
  };

  // The draft outlives a closed dialog, so reopening Help returns the reporter
  // to what they were writing.
  useEffect(() => {
    if (!isOpen && !reportOpen) resetDialogState();
  }, [isOpen, reportOpen]);

  // A kept draft can sit closed while the reporter goes back and reproduces
  // the bug, so its diagnostics are read again on the way in. The old snapshot
  // stays up until the new one lands, so there is never a gap with nothing to
  // show or send.
  useEffect(() => {
    if (isOpen || !reportOpen) return;
    setDiagnosticsRun((run) => run + 1);
  }, [isOpen, reportOpen]);

  // A route change can unmount the dialog while a draft still holds a capture
  // and an upload is in flight. Neither should outlive the screen.
  useEffect(() => () => cancelReport(), []);

  // The preload guard is scoped to one opening, so a repeat force-close on the
  // same chat preloads again.
  useEffect(() => {
    if (!isOpen) preloadedChatId.current = null;
  }, [isOpen]);

  // Loaded when the form opens so the disclosure can show what will be sent.
  // Read here rather than through react-query: the disclosure and the issue
  // body have to show the same snapshot, and a shared cache could refresh
  // under the reporter between reviewing it and sending it.
  useEffect(() => {
    if (screen !== "form") return;
    let active = true;
    const request = ipc.system.getSystemDebugInfo();
    diagnosticsRequest.current = request;
    request
      .then((info) => {
        if (!active) return;
        setFormDebugInfo(info);
        setFormDebugInfoFailed(false);
      })
      .catch((error) => {
        console.error("Failed to load diagnostics preview:", error);
        if (active) setFormDebugInfoFailed(true);
      });
    return () => {
      active = false;
    };
  }, [screen, diagnosticsRun]);

  // A crash-triggered report opens the form with the session already ticked.
  useEffect(() => {
    if (!isOpen) return;
    const chatId = helpDialog.uploadChatId;
    if (chatId == null || preloadedChatId.current === chatId) return;
    preloadedChatId.current = chatId;
    beginReport(chatId, "force-close");
    setDirection(1);
    setScreen("form");
    hasNavigated.current = true;
  }, [isOpen, helpDialog.uploadChatId]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Everything a report starts from. Both entry points go through here so a
   * new report cannot inherit anything from the last one.
   */
  const beginReport = (chatId: number | null, source: ReportSource) => {
    reportSource.current = source;
    posthog.capture("issue-form:opened", { source });
    cancelReport();
    blockedReported.current = false;
    setReportOpen(true);
    setDescription("");
    setAtCap(false);
    setIncludeSystemInfo(true);
    setIncludeSession(true);
    setSessionChatId(chatId);
    setScreenshot(null);
    setScreenshotPreview(null);
    setCaptureId(null);
    setIsCapturing(false);
    setIsFiling(false);
    setFormDebugInfo(null);
    setFormDebugInfoFailed(false);
    setDiagnosticsRun((run) => run + 1);
    setDebugBundle(null);
    setBundleLoading(false);
  };

  const startReport = () => {
    beginReport(selectedChatId, "report-bug");
    navigateTo("form");
  };

  const reportBlocked = () => {
    if (blockedReported.current) return;
    blockedReported.current = true;
    posthog.capture("issue-form:blocked", {
      source: reportSource.current,
    });
  };

  const handleBack = () => {
    cancelReport();
    setIsFiling(false);
    setReportOpen(false);
    setDescription("");
    setAtCap(false);
    setScreenshot(null);
    setScreenshotPreview(null);
    setCaptureId(null);
    navigateTo("main");
  };

  /**
   * The one session read a report gets. Both the disclosure and the upload go
   * through here, so whichever runs second joins the first instead of
   * serialising the codebase again and sending a different snapshot than the
   * one the reporter reviewed.
   */
  const readSession = (chatId: number): Promise<SessionDebugBundle> => {
    const inFlight = sessionRequest.current;
    if (inFlight) return inFlight;
    const request = ipc.misc.getSessionDebugBundle(chatId);
    sessionRequest.current = request;
    // A failure must not be remembered, or every later attempt re-awaits it.
    request.catch(() => {
      if (sessionRequest.current === request) sessionRequest.current = null;
    });
    return request;
  };

  const loadSessionBundle = () => {
    if (debugBundle || bundleLoading || sessionChatId == null) return;
    // Reading a session serialises the whole codebase, so it can outlive the
    // report that asked for it.
    const token = captureToken.current;
    setBundleLoading(true);
    readSession(sessionChatId)
      .then((loaded) => {
        if (captureToken.current === token) setDebugBundle(loaded);
      })
      .catch((error) => {
        console.error("Failed to load chat session:", error);
        if (captureToken.current === token) {
          showError(t("home:help.failedToLoadChatSession"));
        }
      })
      .finally(() => {
        if (captureToken.current === token) setBundleLoading(false);
      });
  };

  /**
   * Uploads the session and returns the ID the issue body references.
   *
   * The session is the reporter's private data, so backing out has to stop it
   * being sent. Serialising the codebase and fetching the signed URL send
   * nothing and are checked between, which is where the protection actually
   * comes from: those are the slow steps. Once the PUT starts, aborting only
   * helps while the body is still streaming -- a small bundle is already gone.
   */
  const uploadSession = async (
    chatId: number,
    loaded: SessionDebugBundle | null,
    token: number,
  ): Promise<string | null> => {
    const bundle = loaded ?? (await readSession(chatId));
    if (captureToken.current !== token) return null;

    const response = await fetch(UPLOAD_URL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        extension: "json",
        contentType: "application/json",
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to get upload URL: ${response.statusText}`);
    }
    const { uploadUrl, filename } = await response.json();
    if (captureToken.current !== token) return null;

    const uploadId = crypto.randomUUID();
    activeUpload.current = uploadId;
    try {
      await ipc.system.uploadToSignedUrl({
        url: uploadUrl,
        contentType: "application/json",
        data: bundle,
        uploadId,
      });
    } finally {
      if (activeUpload.current === uploadId) activeUpload.current = null;
    }
    return "v2:" + filename.replace(".json", "");
  };

  /** Tells main to drop a capture no report will ever paste. */
  const discardCapture = (captureId = activeCapture.current) => {
    if (!captureId) return;
    if (activeCapture.current === captureId) activeCapture.current = null;
    void ipc.system.discardScreenshot({ captureId }).catch((error) => {
      console.error("Failed to discard the screenshot:", error);
    });
  };

  /**
   * Closing the dialog by hand. During a filing this is the same intent as
   * Back -- the reporter has walked away -- so it has to stop the report the
   * same way. The draft survives, as it does for any other dismissal.
   */
  const dismissDialog = () => {
    if (isFiling) {
      // The draft survives a dismissal, so its screenshot is kept rather than
      // discarded. One exception it cannot cover: if the clipboard restore had
      // already succeeded, main dropped the image at that point and the
      // preview outlives it.
      cancelReport({ keepCapture: true });
      setIsFiling(false);
    }
    onClose();
  };

  /**
   * Ends the current report. Bumping the token orphans everything already in
   * flight; the upload is the one thing that keeps sending regardless, so it
   * is aborted rather than left to finish.
   */
  const cancelReport = ({ keepCapture = false } = {}) => {
    captureToken.current++;
    sessionRequest.current = null;
    diagnosticsRequest.current = null;
    setBundleLoading(false);
    if (!keepCapture) discardCapture();
    const uploadId = activeUpload.current;
    if (!uploadId) return;
    activeUpload.current = null;
    void ipc.system
      .cancelUpload({ uploadId })
      .then(({ cancelled }) => {
        // False means the PUT had already finished, so the session did reach
        // the service. Worth seeing in the logs rather than assuming.
        if (!cancelled) {
          console.warn("Session upload finished before it could be cancelled");
        }
      })
      .catch((error) => {
        console.error("Failed to cancel the session upload:", error);
      });
  };

  const captureScreenshot = () => {
    if (isCapturing) return;
    const token = captureToken.current;
    setIsCapturing(true);
    posthog.capture("screenshot-prompt:capture-attempt", {
      source: reportSource.current,
    });
    // The dialog hides so that it stays out of the picture.
    onClose();
    setTimeout(async () => {
      try {
        const capture = await ipc.system.takeScreenshot();
        if (captureToken.current !== token) {
          // Main stored it before the guard could run, and the report it
          // belongs to no longer exists.
          discardCapture(capture.captureId);
          return;
        }
        setScreenshot({ status: "captured" });
        setScreenshotPreview(capture.dataUrl);
        // A retake replaces the previous image, which nothing will paste.
        discardCapture();
        activeCapture.current = capture.captureId;
        setCaptureId(capture.captureId);
        posthog.capture("screenshot-prompt:captured", {
          source: reportSource.current,
        });
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Failed to take screenshot";
        if (captureToken.current !== token) return;
        posthog.capture("screenshot-prompt:capture-failed", {
          source: reportSource.current,
          failure: classifyCaptureFailure(reason),
        });
        showError(reason);
        // A failed retake still leaves the earlier capture on the clipboard
        // and in main, so it stays the report's screenshot rather than being
        // replaced by an error and an empty box.
        if (activeCapture.current) return;
        setScreenshot({ status: "capture-failed", reason });
        setScreenshotPreview(null);
        setCaptureId(null);
      } finally {
        // Both belong to the report that started the capture: by now the
        // reporter may have filed, or started a report that owns the flag.
        if (captureToken.current === token) {
          setIsCapturing(false);
          setHelpDialog({ open: true });
        }
      }
    }, 200); // Small delay for the dialog to close
  };

  const removeScreenshot = () => {
    posthog.capture("screenshot-prompt:removed", {
      source: reportSource.current,
    });
    discardCapture();
    setScreenshot(null);
    setScreenshotPreview(null);
    setCaptureId(null);
  };

  const handleSubmit = () => {
    const report: OutgoingReport = {
      description,
      screenshot: screenshot ?? { status: "declined" },
      includeSystemInfo,
      includeSession: includeSession && sessionChatId != null,
      chatId: sessionChatId ?? null,
      bundle: debugBundle,
      captureId,
      debugInfo: formDebugInfo,
    };
    setIsFiling(true);
    void fileReport(report, captureToken.current);
  };

  const fileReport = async (report: OutgoingReport, token: number) => {
    // Every one of these says the report is being filed anyway, so none of
    // them may reach a reporter who has already backed out of it.
    const tellReporter = (message: string) => {
      if (captureToken.current === token) showError(message);
    };

    let sessionId: string | null = null;
    if (report.includeSession && report.chatId != null) {
      try {
        sessionId = await uploadSession(report.chatId, report.bundle, token);
      } catch (error) {
        // A failed upload must not cost the reporter their whole report.
        console.error("Failed to upload chat session:", error);
        tellReporter(t("home:report.sessionUploadFailed"));
      }
    }

    // Normally the reviewed snapshot rather than a fresh read: what the
    // disclosure showed is what gets sent. The exception is below -- a submit
    // that lands before the read does.
    let debugInfo = report.debugInfo;
    if (report.includeSystemInfo && !debugInfo && diagnosticsRequest.current) {
      // Submitted while the disclosure was still loading. The read is already
      // running, so give it a moment rather than call the report
      // undiagnosable -- but never wait on it indefinitely: these are shell
      // commands with no timeout of their own, and one wedged behind a proxy
      // or a dead network drive would strand the reporter on a spinner with
      // no way to file at all.
      let deadline: ReturnType<typeof setTimeout> | undefined;
      debugInfo = await Promise.race([
        diagnosticsRequest.current.catch(() => null),
        new Promise<null>((resolve) => {
          deadline = setTimeout(
            () => resolve(null),
            DIAGNOSTICS_SUBMIT_WAIT_MS,
          );
        }),
      ]);
      clearTimeout(deadline);
    }

    let diagnostics: Diagnostics | "unavailable" | null = null;
    if (report.includeSystemInfo) {
      if (debugInfo) {
        diagnostics = {
          debugInfo,
          settings,
          selectedModel: diagnosticModelSelection,
          userBudget: userBudget ?? undefined,
        };
      } else {
        // Asked for but never read, so it is marked as unavailable rather
        // than as the reporter having declined.
        diagnostics = "unavailable";
        tellReporter(t("home:report.systemInfoFailed"));
      }
    }

    // Everything past here is visible outside the dialog, and the upload above
    // has no timeout, so a reporter who gave up and pressed Back could see it
    // land minutes later with nothing on screen to explain it. Back landing
    // inside the clipboard write below is still too late to take it back.
    if (captureToken.current !== token) return;

    // Put the capture back on the clipboard now: the reporter pastes it into
    // GitHub next, and anything they copied since would have replaced it.
    let outgoingScreenshot = report.screenshot;
    if (outgoingScreenshot.status === "captured" && report.captureId) {
      let copied = false;
      try {
        ({ copied } = await ipc.system.recopyScreenshot({
          captureId: report.captureId,
        }));
      } catch (error) {
        console.error("Failed to copy the screenshot:", error);
      }
      if (copied && activeCapture.current === report.captureId) {
        activeCapture.current = null;
      }
      if (!copied) {
        // The capture itself worked and may still be on the clipboard, but
        // nothing can promise that now, so the issue must not tell a
        // maintainer to expect an image.
        outgoingScreenshot = {
          status: "capture-failed",
          reason: "The screenshot could no longer be restored for pasting",
        };
        tellReporter(t("home:report.screenshotRestoreFailed"));
      }
    }

    if (captureToken.current !== token) return;
    openGitHubIssue({
      body: buildIssueBody({
        description: report.description,
        screenshot: outgoingScreenshot,
        diagnostics,
        sessionId,
        redactedUserId: userBudget?.redactedUserId,
      }),
      isDyadProUser,
    });

    // Only tears down the report it filed: the reporter may have moved on.
    if (captureToken.current !== token) return;
    captureToken.current++;
    setIsFiling(false);
    setReportOpen(false);
    onClose();
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
        <DialogTitle>{t("home:help.needHelp")}</DialogTitle>
      </DialogHeader>
      <DialogDescription>{t("home:help.helpOptions")}</DialogDescription>
      <div className="flex flex-col w-full mt-4 space-y-5">
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
            <BookOpenIcon className="mr-2 h-5 w-5" /> {t("home:help.openDocs")}
          </Button>
        )}

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("home:report.reportAnIssue")}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="border rounded-lg p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("home:report.reportBugBlurb")}
          </p>
          <Button
            variant="outline"
            onClick={startReport}
            className="w-full bg-(--background-lightest)"
          >
            <BugIcon className="mr-2 h-4 w-4" /> {t("home:help.reportBug")}
          </Button>
        </div>
      </div>
    </AnimatedScreen>
  );

  const renderFormScreen = () => (
    <AnimatedScreen
      screenKey="form"
      direction={direction}
      className="flex flex-col overflow-hidden"
    >
      <DialogHeader>
        <DialogTitle className="flex items-center">
          <Button
            variant="ghost"
            aria-label={t("home:report.back")}
            className="mr-2 p-0 h-8 w-8"
            onClick={handleBack}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          {t("home:report.reportBugHeading")}
        </DialogTitle>
      </DialogHeader>

      <div className="overflow-y-auto flex-grow mt-4 p-1.5">
        <IssueForm
          description={description}
          onDescriptionChange={setDescription}
          onBlocked={reportBlocked}
          atCap={atCap}
          onAtCapChange={setAtCap}
          screenshot={
            <ScreenshotField
              outcome={screenshot}
              previewSrc={screenshotPreview}
              isCapturing={isCapturing}
              locked={isFiling}
              onCapture={captureScreenshot}
              onRemove={removeScreenshot}
            />
          }
          onSubmit={handleSubmit}
          isFiling={isFiling}
          disclosures={
            <ReportDisclosures
              diagnostics={
                formDebugInfo
                  ? formatDiagnosticsSections({
                      debugInfo: formDebugInfo,
                      settings,
                      selectedModel: diagnosticModelSelection,
                      userBudget: userBudget ?? undefined,
                    })
                  : null
              }
              diagnosticsFailed={formDebugInfoFailed}
              includeSystemInfo={includeSystemInfo}
              onIncludeSystemInfoChange={setIncludeSystemInfo}
              bundle={debugBundle}
              bundleLoading={bundleLoading}
              includeSession={includeSession && sessionChatId != null}
              onIncludeSessionChange={setIncludeSession}
              onSessionExpand={loadSessionBundle}
              locked={isFiling}
              sessionUnavailableReason={
                sessionChatId == null
                  ? t("home:report.sessionUnavailable")
                  : undefined
              }
            />
          }
        />
      </div>
    </AnimatedScreen>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <Dialog open={isOpen} onOpenChange={dismissDialog}>
        <DialogContent
          className={
            screen === "form"
              ? "max-h-[80vh] overflow-hidden flex flex-col"
              : undefined
          }
        >
          <AnimatePresence mode="wait" custom={direction}>
            {screen === "main" && renderMainScreen()}
            {screen === "form" && renderFormScreen()}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
      <HelpBotDialog
        isOpen={isHelpBotOpen}
        onClose={() => setIsHelpBotOpen(false)}
      />
    </>
  );
}
