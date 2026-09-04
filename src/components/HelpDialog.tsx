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

/**
 * Why a captured screenshot is no longer available. Shown to the reporter and
 * carried into the issue, so it stays in English like the OS failures beside
 * it rather than being translated for one audience and not the other.
 */
const SCREENSHOT_LOST_REASON =
  "The screenshot could no longer be restored for pasting";

/** Which entry point a report came from, carried on every event it emits. */
type ReportSource = "report-bug" | "force-close";

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

function openGitHubIssue(params: {
  body: string;
  isDyadProUser: unknown;
}): Promise<void> {
  const labels = ["bug"];
  if (params.isDyadProUser) labels.push("pro");
  return ipc.system.openExternalUrl(
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
  // they can see, so the body never carries anything else. A submit that
  // beats the read files without diagnostics rather than sending a snapshot
  // that was never on screen and can no longer be unticked.
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
  // What main still holds for this form, so it can be told to drop it. Read
  // from teardown, which runs from effects where captured state may already
  // be a render behind -- hence a ref rather than the state.
  const activeCapture = useRef<string | null>(null);
  // What the form is currently showing. Distinct from `activeCapture`, which
  // a successful restore clears while the preview deliberately stays up.
  const displayedCapture = useRef<string | null>(null);
  // False once the component is unmounted -- not merely when the dialog is
  // dismissed, which keeps the draft and must still be told about changes.
  const mounted = useRef(true);
  // The session this report already uploaded. A retry reuses it rather than
  // sending the reporter's chat and codebase a second time and leaving the
  // first copy on the service with no issue pointing at it.
  const uploadedSession = useRef<string | null>(null);
  // Set when the dialog hides itself for a capture, and consumed by the
  // re-read effect below. A flag rather than `isCapturing`, which can strand
  // true on a capture that never lands and would then suppress it forever.
  const hidingForCapture = useRef(false);
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
    showCapture(null);
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
    // The dialog hid itself for a screenshot rather than the reporter
    // leaving, so re-reading now would cost three shell commands a retake.
    if (hidingForCapture.current) {
      hidingForCapture.current = false;
      return;
    }
    setDiagnosticsRun((run) => run + 1);
  }, [isOpen, reportOpen]);

  // A route change can unmount the dialog while a draft still holds a capture
  // and an upload is in flight. Neither should outlive the screen.
  useEffect(() => {
    // Set on every run, not just the first: StrictMode tears the effect down
    // and re-runs it on the same instance, and an empty body here would leave
    // this false -- silently inverting both guards below for the whole
    // session.
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelReport();
    };
  }, []);

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
    showCapture(null);
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
    showCapture(null);
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
    const alreadyUploaded = uploadedSession.current;
    if (alreadyUploaded) return alreadyUploaded;

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
    const sessionId = "v2:" + filename.replace(".json", "");
    // Only the report that made this upload may remember it. An abort
    // resolves rather than rejects, so without this the continuation of a
    // cancelled upload would resurrect the cache the cancel just cleared.
    if (captureToken.current === token) uploadedSession.current = sessionId;
    return sessionId;
  };

  /**
   * The form is offering an image main no longer holds -- either the restore
   * failed, or it succeeded and main dropped it on the way out. Either way it
   * cannot be produced again, so the form must stop promising it. Marked
   * failed rather than cleared: cleared would file as "declined" next time,
   * claiming the reporter chose to send nothing.
   */
  const dropStaleScreenshot = () => {
    setScreenshot({
      status: "capture-failed",
      reason: SCREENSHOT_LOST_REASON,
    });
    setScreenshotPreview(null);
    showCapture(null);
  };

  /** Shows a capture on the form, or clears it. Keeps the ref in step. */
  const showCapture = (captureId: string | null) => {
    displayedCapture.current = captureId;
    setCaptureId(captureId);
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
      // discarded. If the restore had already succeeded, main dropped the
      // image at that point -- the next submit asks again, finds nothing, and
      // reports capture-failed rather than promising a paste.
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
    setIsCapturing(false);
    sessionRequest.current = null;
    uploadedSession.current = null;
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
    hidingForCapture.current = true;
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
        showCapture(capture.captureId);
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
        showCapture(null);
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
    showCapture(null);
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
    const token = captureToken.current;
    void fileReport(report, token).catch((error) => {
      // Nothing above is expected to throw, but an unhandled one would leave
      // the reporter on a disabled "Preparing your report..." forever.
      console.error("Failed to file the report:", error);
      if (captureToken.current !== token) return;
      setIsFiling(false);
      showError(t("home:report.filingFailed"));
    });
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

    // The reviewed snapshot, never a fresh read: what the disclosure showed
    // is what gets sent, and nothing else.
    let diagnostics: Diagnostics | "unavailable" | null = null;
    if (report.includeSystemInfo) {
      if (report.debugInfo) {
        diagnostics = {
          debugInfo: report.debugInfo,
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
    // Always ask main rather than remembering a previous restore: a cache
    // would have to assume the image is still on the clipboard, and the
    // reporter can copy anything at any time. Being wrong that way tells a
    // maintainer to expect an image that is not there.
    if (outgoingScreenshot.status === "captured" && report.captureId) {
      let copied = false;
      try {
        ({ copied } = await ipc.system.recopyScreenshot({
          captureId: report.captureId,
        }));
      } catch (error) {
        console.error("Failed to copy the screenshot:", error);
      }
      if (copied) {
        // Only the report that made this restore may remember it, for the
        // same reason as `uploadedSession`: a report the reporter walked away
        // from must not leave a cache saying the image is on the clipboard.
        // The restore consumed the image in main. If the reporter walked away
        // and kept the draft, the preview left behind is a promise nothing
        // can keep.
        if (
          mounted.current &&
          captureToken.current !== token &&
          displayedCapture.current === report.captureId
        ) {
          showError(t("home:report.screenshotDropped"));
          dropStaleScreenshot();
        }
        if (activeCapture.current === report.captureId) {
          activeCapture.current = null;
        }
      }
      if (!copied) {
        // The capture itself worked and may still be on the clipboard, but
        // nothing can promise that now, so the issue must not tell a
        // maintainer to expect an image.
        outgoingScreenshot = {
          status: "capture-failed",
          reason: SCREENSHOT_LOST_REASON,
        };
        // Main no longer holds it, so the form must stop offering it. This
        // runs whichever way the report went: filing can throw and hand the
        // reporter back a live form, so "it is about to be torn down" is not
        // something this branch may assume.
        // The form's own capture, not main's: a successful restore clears
        // main's while the preview deliberately stays up, so keying on that
        // would skip this block for every capture that ever restored.
        const stillOnTheForm =
          mounted.current && displayedCapture.current === report.captureId;
        if (stillOnTheForm) {
          dropStaleScreenshot();
          activeCapture.current = null;
        }
        if (captureToken.current === token) {
          showError(t("home:report.screenshotRestoreFailed"));
        } else if (stillOnTheForm) {
          // A draft they walked away from and will come back to: without this
          // the image just vanishes between one visit and the next.
          showError(t("home:report.screenshotDropped"));
        }
      }
    }

    if (captureToken.current !== token) return;
    await openGitHubIssue({
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
