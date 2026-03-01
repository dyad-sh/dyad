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
  ExternalLinkIcon,
  AlertCircleIcon,
  MessageSquareIcon,
  CopyIcon,
} from "lucide-react";
import { ipc } from "@/ipc/types";
import {
  type ReactNode,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { type SessionDebugBundle, type SystemDebugInfo } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { HelpBotDialog } from "./HelpBotDialog";
import { useSettings } from "@/hooks/useSettings";
import { BugScreenshotDialog } from "./BugScreenshotDialog";
import { useUserBudgetInfo } from "@/hooks/useUserBudgetInfo";
import { type UserSettings } from "@/lib/schemas";
import { type UserBudgetInfo } from "@/ipc/types/system";
import { motion, AnimatePresence } from "framer-motion";

// =============================================================================
// Animation constants
// =============================================================================

type DialogScreen = "main" | "review" | "upload-complete";

const SCREEN_ORDER: DialogScreen[] = ["main", "review", "upload-complete"];

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

const GITHUB_ISSUES_BASE =
  "https://github.com/coney-sh/coney/issues/new" as const;

function formatSettingsLines(settings: UserSettings | null): string {
  if (!settings) return "Settings not available";
  return [
    `- Selected Model: ${settings.selectedModel?.provider}:${settings.selectedModel?.name}`,
    `- Chat Mode: ${settings.selectedChatMode ?? "default"}`,
    `- Auto Approve Changes: ${settings.autoApproveChanges ?? "n/a"}`,
    `- Coney Pro Enabled: ${settings.enableConeyPro ?? "n/a"}`,
    `- Thinking Budget: ${settings.thinkingBudget ?? "n/a"}`,
    `- Runtime Mode: ${settings.runtimeMode2 ?? "n/a"}`,
    `- Release Channel: ${settings.releaseChannel ?? "n/a"}`,
    `- Auto Fix Problems: ${settings.enableAutoFixProblems ?? "n/a"}`,
    `- Native Git: ${settings.enableNativeGit ?? "n/a"}`,
  ].join("\n");
}

function formatSystemInfoSection(
  debugInfo: SystemDebugInfo,
  userBudget: UserBudgetInfo | undefined,
): string {
  return `## System Information
- Coney Version: ${debugInfo.coneyVersion}
- Platform: ${debugInfo.platform}
- Architecture: ${debugInfo.architecture}
- Node Version: ${debugInfo.nodeVersion || "n/a"}
- PNPM Version: ${debugInfo.pnpmVersion || "n/a"}
- Node Path: ${debugInfo.nodePath || "n/a"}
- Pro User ID: ${userBudget?.redactedUserId || "n/a"}
- Telemetry ID: ${debugInfo.telemetryId || "n/a"}
- Model: ${debugInfo.selectedLanguageModel || "n/a"}`;
}

function formatLogsSection(debugInfo: SystemDebugInfo): string {
  return `## Logs
\`\`\`
${debugInfo.logs.slice(-3_500) || "No logs available"}
\`\`\``;
}

function openGitHubIssue(params: {
  title: string;
  labels: string[];
  body: string;
  isConeyProUser: unknown;
}) {
  const labels = [...params.labels];
  if (params.isConeyProUser) labels.push("pro");
  const qs = new URLSearchParams({
    title: params.title,
    labels: labels.join(","),
    body: params.body,
  });
  ipc.system.openExternalUrl(`${GITHUB_ISSUES_BASE}?${qs.toString()}`);
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

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [text]);

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

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpDialog({ isOpen, onClose }: HelpDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [screen, setScreen] = useState<DialogScreen>("main");
  const [direction, setDirection] = useState(0);
  const [debugBundle, setDebugBundle] = useState<SessionDebugBundle | null>(
    null,
  );
  const [sessionId, setSessionId] = useState("");
  const [isHelpBotOpen, setIsHelpBotOpen] = useState(false);
  const [isBugScreenshotOpen, setIsBugScreenshotOpen] = useState(false);
  const hasNavigated = useRef(false);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { settings } = useSettings();
  const { userBudget } = useUserBudgetInfo();
  const isConeyProUser = settings?.providerSettings?.["auto"]?.apiKey?.value;

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
    setIsLoading(false);
    setIsUploading(false);
    setScreen("main");
    setDirection(0);
    setDebugBundle(null);
    setSessionId("");
    hasNavigated.current = false;
  };

  useEffect(() => {
    if (!isOpen) resetDialogState();
  }, [isOpen]);

  const handleClose = () => onClose();

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleReportBug = async () => {
    setIsLoading(true);
    try {
      const debugInfo = await ipc.system.getSystemDebugInfo();
      const body = `\
<!-- Please fill in all fields in English -->

## Bug Description (required)
<!-- Please describe the issue you're experiencing and how to reproduce it -->

## Screenshot (recommended)
<!-- Screenshot of the bug -->

${formatSystemInfoSection(debugInfo, userBudget ?? undefined)}

## Settings
${formatSettingsLines(settings)}

${formatLogsSection(debugInfo)}
`;
      openGitHubIssue({
        title: "[bug] <WRITE TITLE HERE>",
        labels: ["bug"],
        body,
        isConeyProUser,
      });
    } catch (error) {
      console.error("Failed to prepare bug report:", error);
      ipc.system.openExternalUrl(GITHUB_ISSUES_BASE);
    } finally {
      setIsLoading(false);
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
        "https://upload-logs.coney.sh/generate-upload-url",
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

  const handleOpenGitHubIssue = async () => {
    try {
      const debugInfo = await ipc.system.getSystemDebugInfo();
      const body = `\
<!-- Please fill in all fields in English -->

Session ID: ${sessionId}
Session Schema: v2.0
Pro User ID: ${userBudget?.redactedUserId || "n/a"}

## Issue Description (required)
<!-- Please describe the issue you're experiencing -->

## Expected Behavior (required)
<!-- What did you expect to happen? -->

## Actual Behavior (required)
<!-- What actually happened? -->

${formatSystemInfoSection(debugInfo, userBudget ?? undefined)}

## Settings
${formatSettingsLines(settings)}

${formatLogsSection(debugInfo)}
`;
      openGitHubIssue({
        title: "[session report] <add title>",
        labels: ["support"],
        body,
        isConeyProUser,
      });
    } catch (error) {
      console.error("Failed to prepare session report:", error);
      openGitHubIssue({
        title: "[session report] <add title>",
        labels: ["support"],
        body: `Session ID: ${sessionId}\nSession Schema: v2.0\nPro User ID: ${userBudget?.redactedUserId || "n/a"}`,
        isConeyProUser,
      });
    }
    handleClose();
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
        <DialogTitle>Need help with Coney?</DialogTitle>
      </DialogHeader>
      <DialogDescription>
        If you need help or want to report an issue, here are some options:
      </DialogDescription>
      <div className="flex flex-col w-full mt-4 space-y-5">
        {/* Self-service help */}
        {isConeyProUser ? (
          <Button
            variant="default"
            onClick={() => setIsHelpBotOpen(true)}
            className="w-full py-6 border-primary/50 shadow-sm shadow-primary/10 transition-all hover:shadow-md hover:shadow-primary/15"
          >
            <SparklesIcon className="mr-2 h-5 w-5" /> Chat with Coney help bot
            (Pro)
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() =>
              ipc.system.openExternalUrl("https://www.coney.sh/docs")
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
                AI / Coney Pro issues
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
              Includes error logs to troubleshoot non-AI issues with Coney (UI
              bugs, crashes, setup problems, etc.).
            </p>
            <Button
              variant="outline"
              onClick={() => {
                handleClose();
                setIsBugScreenshotOpen(true);
              }}
              disabled={isLoading}
              className="w-full bg-(--background-lightest)"
            >
              <BugIcon className="mr-2 h-4 w-4" />{" "}
              {isLoading ? "Preparing Report..." : "Report a Bug"}
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

          <ReviewDetailsSection title="System Information" mono={false}>
            <p>Coney Version: {debugBundle.system.coneyVersion}</p>
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
        onClick={handleOpenGitHubIssue}
        className="w-full py-5 text-base mt-4"
        size="lg"
      >
        <ExternalLinkIcon className="mr-2 h-5 w-5" />
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent
          className={
            screen === "review"
              ? "max-w-4xl max-h-[80vh] overflow-hidden flex flex-col"
              : undefined
          }
        >
          <AnimatePresence mode="wait" custom={direction}>
            {screen === "main" && renderMainScreen()}
            {screen === "review" && renderReviewScreen()}
            {screen === "upload-complete" && renderUploadCompleteScreen()}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
      <HelpBotDialog
        isOpen={isHelpBotOpen}
        onClose={() => setIsHelpBotOpen(false)}
      />
      <BugScreenshotDialog
        isOpen={isBugScreenshotOpen}
        onClose={() => setIsBugScreenshotOpen(false)}
        handleReportBug={handleReportBug}
        isLoading={isLoading}
      />
    </>
  );
}
