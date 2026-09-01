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
import { showError, showInfo } from "@/lib/toast";
import { useTranslation } from "react-i18next";
import { HelpBotDialog } from "./HelpBotDialog";
import { useSettings } from "@/hooks/useSettings";
import { BugScreenshotDialog, type PendingReport } from "./BugScreenshotDialog";
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
  type ScreenshotOutcome,
} from "@/lib/issueBody";
import { IssueForm } from "./IssueForm";
import { ReportDisclosures } from "./ReportDisclosures";

const UPLOAD_URL_ENDPOINT = "https://upload-logs.dyad.sh/generate-upload-url";

type DialogScreen = "main" | "form";

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

  // Shown in the disclosures. The body is built from a fresh read at submit
  // time, so what ships is never staler than the report.
  const [formDebugInfo, setFormDebugInfo] = useState<SystemDebugInfo | null>(
    null,
  );
  const [formDebugInfoFailed, setFormDebugInfoFailed] = useState(false);
  const [debugBundle, setDebugBundle] = useState<SessionDebugBundle | null>(
    null,
  );
  const [bundleLoading, setBundleLoading] = useState(false);

  const [isScreenshotPromptOpen, setIsScreenshotPromptOpen] = useState(false);
  const [pendingReport, setPendingReport] = useState<PendingReport | null>(
    null,
  );

  const hasNavigated = useRef(false);
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

  const chatForSession = helpDialog.uploadChatId ?? selectedChatId;

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
    hasNavigated.current = false;
    preloadedChatId.current = null;
  };

  // The draft outlives a closed dialog, so reopening Help returns the reporter
  // to what they were writing.
  useEffect(() => {
    if (!isOpen && !pendingReport && !reportOpen) resetDialogState();
  }, [isOpen, pendingReport, reportOpen]);

  // The preload guard is scoped to one opening, so a repeat force-close on the
  // same chat preloads again.
  useEffect(() => {
    if (!isOpen) preloadedChatId.current = null;
  }, [isOpen]);

  // Loaded when the form opens so the disclosure can show what will be sent.
  useEffect(() => {
    if (screen !== "form" || formDebugInfo || formDebugInfoFailed) return;
    let active = true;
    ipc.system
      .getSystemDebugInfo()
      .then((info) => {
        if (active) setFormDebugInfo(info);
      })
      .catch((error) => {
        console.error("Failed to load diagnostics preview:", error);
        if (active) setFormDebugInfoFailed(true);
      });
    return () => {
      active = false;
    };
  }, [screen, formDebugInfo, formDebugInfoFailed]);

  // A crash-triggered report opens the form with the session already ticked.
  useEffect(() => {
    if (!isOpen) return;
    const chatId = helpDialog.uploadChatId;
    if (chatId == null || preloadedChatId.current === chatId) return;
    preloadedChatId.current = chatId;
    setReportOpen(true);
    setDescription("");
    setIncludeSession(true);
    setIncludeSystemInfo(true);
    setDirection(1);
    setScreen("form");
    hasNavigated.current = true;
  }, [isOpen, helpDialog.uploadChatId]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const startReport = () => {
    posthog.capture("issue-form:opened", { source: "report-bug" });
    setReportOpen(true);
    setDescription("");
    setAtCap(false);
    setIncludeSystemInfo(true);
    setIncludeSession(true);
    navigateTo("form");
  };

  const handleBack = () => {
    setReportOpen(false);
    setDescription("");
    setAtCap(false);
    navigateTo("main");
  };

  const loadSessionBundle = () => {
    if (debugBundle || bundleLoading || chatForSession == null) return;
    setBundleLoading(true);
    ipc.misc
      .getSessionDebugBundle(chatForSession)
      .then(setDebugBundle)
      .catch((error) => {
        console.error("Failed to load chat session:", error);
        showError(t("home:help.failedToLoadChatSession"));
      })
      .finally(() => setBundleLoading(false));
  };

  /** Uploads the session and returns the ID the issue body references. */
  const uploadSession = async (chatId: number): Promise<string> => {
    const bundle =
      debugBundle ?? (await ipc.misc.getSessionDebugBundle(chatId));
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
    await ipc.system.uploadToSignedUrl({
      url: uploadUrl,
      contentType: "application/json",
      data: bundle,
    });
    return "v2:" + filename.replace(".json", "");
  };

  const handleSubmit = () => {
    openScreenshotPrompt({
      description,
      includeSystemInfo,
      includeSession: includeSession && chatForSession != null,
      chatId: chatForSession ?? null,
    });
  };

  const openScreenshotPrompt = (report: PendingReport) => {
    setPendingReport(report);
    onClose();
    setIsScreenshotPromptOpen(true);
  };

  const fileReport = async (
    screenshot: ScreenshotOutcome,
    report: PendingReport,
  ) => {
    showInfo("Preparing your report...");

    let sessionId: string | null = null;
    if (report.includeSession && report.chatId != null) {
      try {
        sessionId = await uploadSession(report.chatId);
      } catch (error) {
        // A failed upload must not cost the reporter their whole report.
        console.error("Failed to upload chat session:", error);
        showError(
          "Could not upload your chat session. Filing the report without it.",
        );
      }
    }

    let diagnostics = null;
    if (report.includeSystemInfo) {
      try {
        diagnostics = {
          debugInfo: await ipc.system.getSystemDebugInfo(),
          settings,
          selectedModel: diagnosticModelSelection,
          userBudget: userBudget ?? undefined,
        };
      } catch (error) {
        console.error("Failed to gather diagnostics:", error);
      }
    }

    openGitHubIssue({
      body: buildIssueBody({
        description: report.description,
        screenshot,
        diagnostics,
        sessionId,
        redactedUserId: userBudget?.redactedUserId,
      }),
      isDyadProUser,
    });
  };

  const handleScreenshotPromptContinue = (
    screenshot: ScreenshotOutcome,
    report: PendingReport,
  ) => {
    const ownsDraft = pendingReport === report;
    setPendingReport((current) => (current === report ? null : current));
    if (ownsDraft) {
      setReportOpen(false);
      setDescription("");
      setAtCap(false);
    }
    void fileReport(screenshot, report);
  };

  // A prompt on screen belongs to a newer report, so an abandoned capture
  // leaves it in place rather than closing it.
  const handleCaptureAbandon = () => {
    if (isScreenshotPromptOpen) return;
    setPendingReport(null);
    setHelpDialog({ open: true });
  };

  // Backing out of the prompt returns the reporter to the form as they left it.
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

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Report an issue
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="border rounded-lg p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Tell us what went wrong. You choose what to send along with it.
          </p>
          <Button
            variant="outline"
            onClick={startReport}
            className="w-full bg-(--background-lightest)"
          >
            <BugIcon className="mr-2 h-4 w-4" /> Report a Bug
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
            aria-label="Back"
            className="mr-2 p-0 h-8 w-8"
            onClick={handleBack}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          Report a bug
        </DialogTitle>
      </DialogHeader>

      <div className="overflow-y-auto flex-grow mt-4 p-1.5">
        <IssueForm
          description={description}
          onDescriptionChange={setDescription}
          atCap={atCap}
          onAtCapChange={setAtCap}
          screenshot={null}
          onSubmit={handleSubmit}
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
              includeSession={includeSession && chatForSession != null}
              onIncludeSessionChange={setIncludeSession}
              onSessionExpand={loadSessionBundle}
              sessionUnavailableReason={
                chatForSession == null
                  ? "Open a chat first to include a session."
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
      <Dialog open={isOpen} onOpenChange={onClose}>
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
      <BugScreenshotDialog
        isOpen={isScreenshotPromptOpen}
        onClose={() => setIsScreenshotPromptOpen(false)}
        onDismiss={handleScreenshotPromptDismiss}
        onCaptureAbandon={handleCaptureAbandon}
        onContinue={handleScreenshotPromptContinue}
        source="report-bug"
        report={pendingReport}
      />
    </>
  );
}
