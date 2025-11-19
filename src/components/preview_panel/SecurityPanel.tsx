import { useAtomValue, useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useSecurityReview } from "@/hooks/useSecurityReview";
import { IpcClient } from "@/ipc/ipc_client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Shield,
  AlertTriangle,
  AlertCircle,
  Info,
  ChevronDown,
  Pencil,
  Wrench,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useStreamChat } from "@/hooks/useStreamChat";
import { showError } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { SecurityFinding, SecurityReviewResult } from "@/ipc/ipc_types";
import { useState, useEffect } from "react";
import { VanillaMarkdownParser } from "@/components/chat/DyadMarkdownParser";
import { showSuccess, showWarning } from "@/lib/toast";
import { useLoadAppFile } from "@/hooks/useLoadAppFile";
import { useQueryClient } from "@tanstack/react-query";

const getSeverityColor = (level: SecurityFinding["level"]) => {
  switch (level) {
    case "critical":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800";
    case "high":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800";
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800";
    case "low":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300 border-gray-200 dark:border-gray-800";
  }
};

const getSeverityIcon = (level: SecurityFinding["level"]) => {
  switch (level) {
    case "critical":
      return <AlertTriangle className="h-4 w-4" />;
    case "high":
      return <AlertCircle className="h-4 w-4" />;
    case "medium":
      return <AlertCircle className="h-4 w-4" />;
    case "low":
      return <Info className="h-4 w-4" />;
  }
};

const DESCRIPTION_PREVIEW_LENGTH = 150;

const createFindingKey = (finding: {
  title: string;
  level: string;
  description: string;
}): string => {
  return JSON.stringify({
    title: finding.title,
    level: finding.level,
    description: finding.description,
  });
};

const formatTimeAgo = (input: string | number | Date): string => {
  const timestampMs = new Date(input).getTime();
  const nowMs = Date.now();
  const diffMs = Math.max(0, nowMs - timestampMs);

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const getSeverityOrder = (level: SecurityFinding["level"]): number => {
  switch (level) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
};

function SeverityBadge({ level }: { level: SecurityFinding["level"] }) {
  return (
    <Badge
      variant="outline"
      className={`${getSeverityColor(level)} uppercase text-xs font-semibold flex items-center gap-1 w-fit`}
    >
      <span className="flex-shrink-0">{getSeverityIcon(level)}</span>
      <span>{level}</span>
    </Badge>
  );
}

function RunReviewButton({
  isRunning,
  onRun,
}: {
  isRunning: boolean;
  onRun: () => void;
}) {
  return (
    <Button onClick={onRun} className="gap-2" disabled={isRunning}>
      {isRunning ? (
        <>
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="m4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Running Security Review...
        </>
      ) : (
        <>
          <Shield className="w-4 h-4" />
          Run Security Review
        </>
      )}
    </Button>
  );
}

function ReviewSummary({ data }: { data: SecurityReviewResult }) {
  const counts = data.findings.reduce(
    (acc, finding) => {
      acc[finding.level] = (acc[finding.level] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const severityLevels: Array<SecurityFinding["level"]> = [
    "critical",
    "high",
    "medium",
    "low",
  ];

  return (
    <div className="space-y-1 mt-1">
      <div className="text-sm text-gray-600 dark:text-gray-400">
        Last reviewed {formatTimeAgo(data.timestamp)}
      </div>
      <div className="flex items-center gap-3 text-sm">
        {severityLevels
          .filter((level) => counts[level] > 0)
          .map((level) => (
            <span key={level} className="flex items-center gap-1.5">
              <span className="flex-shrink-0">{getSeverityIcon(level)}</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {counts[level]}
              </span>
              <span className="text-gray-600 dark:text-gray-400 capitalize">
                {level}
              </span>
            </span>
          ))}
      </div>
    </div>
  );
}

function SecurityHeader({
  isRunning,
  onRun,
  data,
  onOpenEditRules,
  selectedCount,
  onFixSelected,
  isFixingSelected,
}: {
  isRunning: boolean;
  onRun: () => void;
  data?: SecurityReviewResult | undefined;
  onOpenEditRules: () => void;
  selectedCount: number;
  onFixSelected: () => void;
  isFixingSelected: boolean;
}) {
  const [isButtonVisible, setIsButtonVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (selectedCount > 0) {
      // Show immediately
      setShouldRender(true);
      // Trigger animation after render
      setTimeout(() => setIsButtonVisible(true), 10);
    } else {
      // Trigger exit animation
      setIsButtonVisible(false);
      // Hide after animation completes
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [selectedCount]);

  return (
    <div className="sticky top-0 z-10 bg-background pt-3 pb-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Security Review
            <Badge variant="secondary" className="uppercase tracking-wide">
              experimental
            </Badge>
          </h1>
          <div className="text-sm">
            <p>
              <a
                className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                onClick={() =>
                  IpcClient.getInstance().openExternalUrl(
                    "https://www.dyad.sh/docs/guides/security-review",
                  )
                }
              >
                Open Security Review docs
              </a>
            </p>
          </div>
          {data && data.findings.length > 0 && <ReviewSummary data={data} />}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button variant="outline" onClick={onOpenEditRules}>
            <Pencil className="w-4 h-4" />
            Edit Security Rules
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={onFixSelected}
              className="gap-2 transition-all duration-300"
              disabled={isFixingSelected}
              style={{
                visibility: shouldRender ? "visible" : "hidden",
                opacity: isButtonVisible ? 1 : 0,
                transform: isButtonVisible
                  ? "translateY(0)"
                  : "translateY(-8px)",
                pointerEvents: shouldRender ? "auto" : "none",
              }}
            >
              {isFixingSelected ? (
                <>
                  <svg
                    className="w-4 h-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="m4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Fixing {selectedCount} Issue{selectedCount !== 1 ? "s" : ""}
                  ...
                </>
              ) : (
                <>
                  <Wrench className="w-4 h-4" />
                  Fix {selectedCount} Issue{selectedCount !== 1 ? "s" : ""}
                </>
              )}
            </Button>
            <RunReviewButton isRunning={isRunning} onRun={onRun} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingView() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
        <svg
          className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="m4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-4">
        Loading...
      </h2>
    </div>
  );
}

function NoAppSelectedView() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
        <Shield className="w-8 h-8 text-gray-400" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
        No App Selected
      </h2>
      <p className="text-gray-600 dark:text-gray-400 max-w-md">
        Select an app to run a security review
      </p>
    </div>
  );
}

function RunningReviewCard() {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center py-8">
          <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="m4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Security review is running
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Results will be available soon.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function NoReviewCard({
  isRunning,
  onRun,
}: {
  isRunning: boolean;
  onRun: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center py-8">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            No Security Review Found
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Run a security review to identify potential vulnerabilities in your
            application.
          </p>
          <RunReviewButton isRunning={isRunning} onRun={onRun} />
        </div>
      </CardContent>
    </Card>
  );
}

function NoIssuesCard({ data }: { data?: SecurityReviewResult }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-center py-8">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            No Security Issues Found
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Your application passed the security review with no issues detected.
          </p>
          {data && (
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
              Last reviewed {formatTimeAgo(data.timestamp)}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FindingsTable({
  findings,
  onOpenDetails,
  onFix,
  fixingFindingKey,
  selectedFindings,
  onToggleSelection,
  onToggleSelectAll,
}: {
  findings: SecurityFinding[];
  onOpenDetails: (finding: SecurityFinding) => void;
  onFix: (finding: SecurityFinding) => void;
  fixingFindingKey?: string | null;
  selectedFindings: Set<string>;
  onToggleSelection: (findingKey: string) => void;
  onToggleSelectAll: () => void;
}) {
  const sortedFindings = [...findings].sort(
    (a, b) => getSeverityOrder(a.level) - getSeverityOrder(b.level),
  );

  const allSelected =
    sortedFindings.length > 0 &&
    sortedFindings.every((finding) =>
      selectedFindings.has(createFindingKey(finding)),
    );

  return (
    <div
      className="border rounded-lg overflow-hidden"
      data-testid="security-findings-table"
    >
      <table className="w-full">
        <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider w-12">
              <Checkbox
                checked={allSelected}
                onCheckedChange={onToggleSelectAll}
                aria-label="Select all issues"
              />
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider w-24">
              Level
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              Issue
            </th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider w-32">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {sortedFindings.map((finding, index) => {
            const isLongDescription =
              finding.description.length > DESCRIPTION_PREVIEW_LENGTH;
            const displayDescription = isLongDescription
              ? finding.description.substring(0, DESCRIPTION_PREVIEW_LENGTH) +
                "..."
              : finding.description;
            const findingKey = createFindingKey(finding);
            const isFixing = fixingFindingKey === findingKey;
            const isSelected = selectedFindings.has(findingKey);

            return (
              <tr
                key={index}
                className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
              >
                <td className="px-4 py-4 align-top">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleSelection(findingKey)}
                    aria-label={`Select ${finding.title}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
                <td className="px-4 py-4 align-top">
                  <SeverityBadge level={finding.level} />
                </td>
                <td className="px-4 py-4">
                  <div
                    className="space-y-2 cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenDetails(finding)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenDetails(finding);
                      }
                    }}
                  >
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {finding.title}
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300 prose prose-sm dark:prose-invert max-w-none">
                      <VanillaMarkdownParser content={displayDescription} />
                    </div>
                    {isLongDescription && (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenDetails(finding);
                        }}
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 py-0 gap-1"
                      >
                        <ChevronDown className="w-3 h-3" />
                        Show more
                      </Button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-4 align-top text-right">
                  <Button
                    onClick={() => onFix(finding)}
                    size="sm"
                    variant="default"
                    className="gap-2"
                    disabled={isFixing}
                  >
                    {isFixing ? (
                      <>
                        <svg
                          className="w-4 h-4 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="m4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Fixing Issue...
                      </>
                    ) : (
                      <>Fix Issue</>
                    )}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FindingDetailsDialog({
  open,
  finding,
  onClose,
  onFix,
  fixingFindingKey,
}: {
  open: boolean;
  finding: SecurityFinding | null;
  onClose: (open: boolean) => void;
  onFix: (finding: SecurityFinding) => void;
  fixingFindingKey?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[80vw] md:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pr-4">
            <span className="truncate">{finding?.title}</span>
            {finding && <SeverityBadge level={finding.level} />}
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm text-gray-700 dark:text-gray-300 prose prose-sm dark:prose-invert max-w-none break-words max-h-[60vh] overflow-auto">
          {finding && <VanillaMarkdownParser content={finding.description} />}
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (finding) {
                onFix(finding);
                onClose(false);
              }
            }}
            disabled={
              finding ? fixingFindingKey === createFindingKey(finding) : false
            }
          >
            {finding && fixingFindingKey === createFindingKey(finding) ? (
              <>
                <svg
                  className="w-4 h-4 animate-spin mr-2"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="m4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Fixing Issue...
              </>
            ) : (
              <>Fix Issue</>
            )}
          </Button>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const SecurityPanel = () => {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const { data, isLoading, error, refetch } = useSecurityReview(selectedAppId);
  const [isRunningReview, setIsRunningReview] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsFinding, setDetailsFinding] = useState<SecurityFinding | null>(
    null,
  );
  const [isEditRulesOpen, setIsEditRulesOpen] = useState(false);
  const [rulesContent, setRulesContent] = useState("");
  const [fixingFindingKey, setFixingFindingKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFindings, setSelectedFindings] = useState<Set<string>>(
    new Set(),
  );
  const [isFixingSelected, setIsFixingSelected] = useState(false);

  const {
    content: fetchedRules,
    loading: isFetchingRules,
    refreshFile: refetchRules,
  } = useLoadAppFile(
    isEditRulesOpen && selectedAppId ? selectedAppId : null,
    isEditRulesOpen ? "SECURITY_RULES.md" : null,
  );

  useEffect(() => {
    if (fetchedRules !== null) {
      setRulesContent(fetchedRules);
    }
  }, [fetchedRules]);

  // Clear selections when data changes (e.g., after a new review)
  useEffect(() => {
    setSelectedFindings(new Set());
  }, [data]);

  const handleSaveRules = async () => {
    if (!selectedAppId) {
      showError("No app selected");
      return;
    }

    try {
      setIsSaving(true);
      const ipcClient = IpcClient.getInstance();
      const { warning } = await ipcClient.editAppFile(
        selectedAppId,
        "SECURITY_RULES.md",
        rulesContent,
      );
      await queryClient.invalidateQueries({
        queryKey: ["versions", selectedAppId],
      });
      if (warning) {
        showWarning(warning);
      } else {
        showSuccess("Security rules saved");
      }
      setIsEditRulesOpen(false);
      refetchRules();
    } catch (err: any) {
      showError(`Failed to save security rules: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const openFindingDetails = (finding: SecurityFinding) => {
    setDetailsFinding(finding);
    setDetailsOpen(true);
  };

  const handleRunSecurityReview = async () => {
    if (!selectedAppId) {
      showError("No app selected");
      return;
    }

    try {
      setIsRunningReview(true);

      // Create a new chat
      const chatId = await IpcClient.getInstance().createChat(selectedAppId);

      // Navigate to the new chat
      setSelectedChatId(chatId);
      await navigate({ to: "/chat", search: { id: chatId } });

      // Stream the security review prompt
      await streamMessage({
        prompt: "/security-review",
        chatId,
        onSettled: () => {
          refetch();
          setIsRunningReview(false);
        },
      });
    } catch (err) {
      showError(`Failed to run security review: ${err}`);
      setIsRunningReview(false);
    }
  };

  const handleFixIssue = async (finding: SecurityFinding) => {
    if (!selectedAppId) {
      showError("No app selected");
      return;
    }

    try {
      const key = createFindingKey(finding);
      setFixingFindingKey(key);

      const chatId = await IpcClient.getInstance().createChat(selectedAppId);

      // Navigate to the new chat
      setSelectedChatId(chatId);
      await navigate({ to: "/chat", search: { id: chatId } });

      const prompt = `Please fix the following security issue in a simple and effective way:

**${finding.title}** (${finding.level} severity)

${finding.description}`;

      await streamMessage({
        prompt,
        chatId,
        onSettled: () => {
          setFixingFindingKey(null);
        },
      });
    } catch (err) {
      showError(`Failed to create fix chat: ${err}`);
      setFixingFindingKey(null);
    }
  };

  const handleToggleSelection = (findingKey: string) => {
    setSelectedFindings((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(findingKey)) {
        newSet.delete(findingKey);
      } else {
        newSet.add(findingKey);
      }
      return newSet;
    });
  };

  const handleToggleSelectAll = () => {
    if (!data?.findings) return;

    const sortedFindings = [...data.findings].sort(
      (a, b) => getSeverityOrder(a.level) - getSeverityOrder(b.level),
    );

    const allKeys = sortedFindings.map((finding) => createFindingKey(finding));
    const allSelected = allKeys.every((key) => selectedFindings.has(key));

    if (allSelected) {
      setSelectedFindings(new Set());
    } else {
      setSelectedFindings(new Set(allKeys));
    }
  };

  const handleFixSelected = async () => {
    if (!selectedAppId || selectedFindings.size === 0 || !data?.findings) {
      showError("No issues selected");
      return;
    }

    try {
      setIsFixingSelected(true);

      // Get the selected findings
      const findingsToFix = data.findings.filter((finding) =>
        selectedFindings.has(createFindingKey(finding)),
      );

      // Create a new chat
      const chatId = await IpcClient.getInstance().createChat(selectedAppId);

      // Navigate to the new chat
      setSelectedChatId(chatId);
      await navigate({ to: "/chat", search: { id: chatId } });

      // Build a comprehensive prompt for all selected issues
      const issuesList = findingsToFix
        .map(
          (finding, index) =>
            `${index + 1}. **${finding.title}** (${finding.level} severity)\n${finding.description}`,
        )
        .join("\n\n");

      const prompt = `Please fix the following ${findingsToFix.length} security issue${findingsToFix.length !== 1 ? "s" : ""} in a simple and effective way:

${issuesList}`;

      await streamMessage({
        prompt,
        chatId,
        onSettled: () => {
          setIsFixingSelected(false);
          setSelectedFindings(new Set());
        },
      });
    } catch (err) {
      showError(`Failed to create fix chat: ${err}`);
      setIsFixingSelected(false);
    }
  };

  if (isLoading) {
    return <LoadingView />;
  }

  if (!selectedAppId) {
    return <NoAppSelectedView />;
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 pt-0 space-y-4">
        <SecurityHeader
          isRunning={isRunningReview}
          onRun={handleRunSecurityReview}
          data={data}
          onOpenEditRules={() => {
            setIsEditRulesOpen(true);
            if (selectedAppId) {
              refetchRules();
            }
          }}
          selectedCount={selectedFindings.size}
          onFixSelected={handleFixSelected}
          isFixingSelected={isFixingSelected}
        />

        {isRunningReview ? (
          <RunningReviewCard />
        ) : error ? (
          <NoReviewCard
            isRunning={isRunningReview}
            onRun={handleRunSecurityReview}
          />
        ) : data && data.findings.length > 0 ? (
          <FindingsTable
            findings={data.findings}
            onOpenDetails={openFindingDetails}
            onFix={handleFixIssue}
            fixingFindingKey={fixingFindingKey}
            selectedFindings={selectedFindings}
            onToggleSelection={handleToggleSelection}
            onToggleSelectAll={handleToggleSelectAll}
          />
        ) : (
          <NoIssuesCard data={data} />
        )}
        <FindingDetailsDialog
          open={detailsOpen}
          finding={detailsFinding}
          onClose={setDetailsOpen}
          onFix={handleFixIssue}
          fixingFindingKey={fixingFindingKey}
        />
        <Dialog open={isEditRulesOpen} onOpenChange={setIsEditRulesOpen}>
          <DialogContent className="sm:max-w-2xl md:max-w-3xl lg:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Edit Security Rules</DialogTitle>
            </DialogHeader>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              This allows you to add additional context about your project
              specifically for security reviews. This content is saved to the{" "}
              <code className="text-xs">SECURITY_RULES.md</code> file. This can
              help catch additional issues or avoid flagging issues that are not
              relevant for your app.
            </div>
            <div className="mt-3">
              <textarea
                className="w-full h-72 rounded-md border border-gray-300 dark:border-gray-700 bg-transparent p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={rulesContent}
                onChange={(e) => setRulesContent(e.target.value)}
                placeholder="# SECURITY_RULES.md\n\nDescribe relevant security context, accepted risks, non-issues, and environment details."
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                onClick={handleSaveRules}
                disabled={isSaving || isFetchingRules}
              >
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};
