import { useAtomValue, useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { isChatPanelHiddenAtom } from "@/atoms/viewAtoms";
import { useSecurityReview } from "@/hooks/useSecurityReview";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  ChevronDown,
  ExternalLink,
  Pencil,
  Wrench,
} from "lucide-react";
import { getSeverityIcon, SeverityBadge } from "@/components/security/severity";
import { useStreamChat } from "@/hooks/useStreamChat";
import { showError } from "@/lib/toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  SecurityFinding,
  SecurityReviewFinding,
  SecurityReviewResult,
} from "@/ipc/types/security";
import { useState, useEffect, useRef } from "react";
import { VanillaMarkdownParser } from "@/components/chat/DyadMarkdownParser";
import { showSuccess, showWarning, toast } from "@/lib/toast";
import { useLoadAppFile } from "@/hooks/useLoadAppFile";
import { useQueryClient } from "@tanstack/react-query";
import { useSelectChat } from "@/hooks/useSelectChat";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const DESCRIPTION_PREVIEW_LENGTH = 150;

const buildFixPrompt = (findings: SecurityFinding[]): string => {
  if (findings.length === 1) {
    const finding = findings[0];
    return `Please fix the following security issue in a simple and effective way:

**${finding.title}** (${finding.level} severity)

${finding.description}`;
  }

  const issuesList = findings
    .map(
      (finding, index) =>
        `${index + 1}. **${finding.title}** (${finding.level} severity)\n${finding.description}`,
    )
    .join("\n\n");

  return `Please fix the following ${findings.length} security issues in a simple and effective way:

${issuesList}`;
};

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

const getSeveritySummaryColor = (level: SecurityFinding["level"]): string => {
  switch (level) {
    case "critical":
      return "border-red-500/20 bg-red-500/8 text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300";
    case "high":
      return "border-orange-500/20 bg-orange-500/8 text-orange-700 dark:border-orange-400/20 dark:bg-orange-400/10 dark:text-orange-300";
    case "medium":
      return "border-amber-500/20 bg-amber-500/8 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300";
    case "low":
      return "border-slate-500/15 bg-slate-500/8 text-slate-700 dark:border-slate-400/20 dark:bg-slate-400/10 dark:text-slate-300";
  }
};

function RunReviewButton({
  isRunning,
  onRun,
  secondary = false,
}: {
  isRunning: boolean;
  onRun: () => void;
  secondary?: boolean;
}) {
  return (
    <Button
      onClick={onRun}
      className="gap-2"
      disabled={isRunning}
      variant={secondary ? "outline" : "default"}
    >
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
          Running review...
        </>
      ) : (
        <>
          <Shield className="w-4 h-4" />
          Run review
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="text-xs text-muted-foreground">
        Last reviewed {formatTimeAgo(data.timestamp)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {severityLevels
          .filter((level) => counts[level] > 0)
          .map((level) => (
            <span
              key={level}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium",
                getSeveritySummaryColor(level),
              )}
            >
              <span className="flex-shrink-0">{getSeverityIcon(level)}</span>
              <span>{counts[level]}</span>
              <span className="capitalize">{level}</span>
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
  onShowSelectedFix,
  onRerunSelectedFix,
  isFixingSelected,
  selectedFixCount,
}: {
  isRunning: boolean;
  onRun: () => void;
  data?: SecurityReviewResult | undefined;
  onOpenEditRules: () => void;
  selectedCount: number;
  onFixSelected: () => void;
  onShowSelectedFix: () => void;
  onRerunSelectedFix: () => void;
  isFixingSelected: boolean;
  selectedFixCount?: number;
}) {
  const hasFindings = Boolean(data?.findings.length);
  const totalFindingCount = data?.findings.length ?? 0;
  const selectedIssueLabel =
    selectedCount > 0
      ? `${selectedCount} issue${selectedCount === 1 ? "" : "s"}`
      : "all issues";
  const existingFixIssueLabel =
    selectedFixCount === totalFindingCount
      ? "all issues"
      : `${selectedFixCount} issue${selectedFixCount === 1 ? "" : "s"}`;
  const hasSelectedFix = selectedFixCount !== undefined;
  const showSelectedFixActions = hasSelectedFix && !isFixingSelected;
  const activeIssueLabel = hasSelectedFix
    ? existingFixIssueLabel
    : selectedIssueLabel;

  return (
    <div className="sticky top-0 z-10 space-y-2.5 bg-background py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-48 flex-1 items-center gap-1">
          <Shield className="size-5 shrink-0" />
          <h1 className="truncate text-lg font-semibold text-foreground">
            Security Review
          </h1>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label="Open Security Review documentation"
                  onClick={() =>
                    ipc.system.openExternalUrl(
                      "https://www.dyad.sh/docs/guides/security-review",
                    )
                  }
                />
              }
            >
              <ExternalLink className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Open Security Review docs</TooltipContent>
          </Tooltip>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  aria-label="Edit security rules"
                  onClick={onOpenEditRules}
                />
              }
            >
              <Pencil className="size-4" />
              Edit rules
            </TooltipTrigger>
            <TooltipContent>Edit security rules</TooltipContent>
          </Tooltip>
          {showSelectedFixActions && (
            <div className="inline-flex">
              <Button
                onClick={onShowSelectedFix}
                variant="outline"
                className="rounded-r-none"
              >
                Show fix for {existingFixIssueLabel}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      className="rounded-l-none border-l-0 px-2"
                      aria-label={`More fix actions for ${existingFixIssueLabel}`}
                    />
                  }
                >
                  <ChevronDown className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onRerunSelectedFix}>
                    <Wrench className="size-4" />
                    Re-run fix
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          <RunReviewButton
            isRunning={isRunning}
            onRun={onRun}
            secondary={hasFindings && !showSelectedFixActions}
          />
          {hasFindings && !showSelectedFixActions && (
            <Button
              onClick={onFixSelected}
              className="gap-2"
              disabled={isFixingSelected}
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
                  Fixing {activeIssueLabel}...
                </>
              ) : (
                <>
                  <Wrench className="w-4 h-4" />
                  Fix {selectedIssueLabel}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
      {hasFindings && data && <ReviewSummary data={data} />}
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

function FindingFixActions({
  finding,
  isFixing,
  onFix,
  onShowFix,
  onRerunFix,
  compact = false,
}: {
  finding: SecurityReviewFinding;
  isFixing: boolean;
  onFix: (finding: SecurityFinding) => void;
  onShowFix: (finding: SecurityReviewFinding) => void;
  onRerunFix: (finding: SecurityReviewFinding) => void;
  compact?: boolean;
}) {
  const size = compact ? "sm" : "default";

  if (isFixing) {
    return (
      <Button size={size} disabled className="gap-2">
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
        Fixing Issue...
      </Button>
    );
  }

  if (!finding.fixChatId) {
    return (
      <Button onClick={() => onFix(finding)} size={size} variant="default">
        Fix Issue
      </Button>
    );
  }

  return (
    <div className="inline-flex">
      <Button
        onClick={() => onShowFix(finding)}
        size={size}
        variant="outline"
        className="rounded-r-none"
      >
        Show fix
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size={size}
              variant="outline"
              className={cn("rounded-l-none border-l-0 px-2", compact && "w-8")}
              aria-label={`More fix actions for ${finding.title}`}
            />
          }
        >
          <ChevronDown className="w-4 h-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onRerunFix(finding)}>
            <Wrench className="w-4 h-4" />
            Re-run fix
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function FindingsTable({
  findings,
  onOpenDetails,
  onFix,
  onShowFix,
  onRerunFix,
  fixingFindingKey,
  selectedFindings,
  onToggleSelection,
  onToggleSelectAll,
}: {
  findings: SecurityReviewFinding[];
  onOpenDetails: (finding: SecurityReviewFinding) => void;
  onFix: (finding: SecurityFinding) => void;
  onShowFix: (finding: SecurityReviewFinding) => void;
  onRerunFix: (finding: SecurityReviewFinding) => void;
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
                  <FindingFixActions
                    finding={finding}
                    isFixing={isFixing}
                    onFix={onFix}
                    onShowFix={onShowFix}
                    onRerunFix={onRerunFix}
                    compact
                  />
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
  onShowFix,
  onRerunFix,
  fixingFindingKey,
}: {
  open: boolean;
  finding: SecurityReviewFinding | null;
  onClose: (open: boolean) => void;
  onFix: (finding: SecurityFinding) => void;
  onShowFix: (finding: SecurityReviewFinding) => void;
  onRerunFix: (finding: SecurityReviewFinding) => void;
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
          {finding && (
            <FindingFixActions
              finding={finding}
              isFixing={fixingFindingKey === createFindingKey(finding)}
              onFix={(selectedFinding) => {
                onFix(selectedFinding);
                onClose(false);
              }}
              onShowFix={(selectedFinding) => {
                onShowFix(selectedFinding);
                onClose(false);
              }}
              onRerunFix={(selectedFinding) => {
                onRerunFix(selectedFinding);
                onClose(false);
              }}
            />
          )}
          <DialogClose className={cn(buttonVariants({ variant: "outline" }))}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const SecurityPanel = () => {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setIsChatPanelHidden = useSetAtom(isChatPanelHiddenAtom);
  const { selectChat } = useSelectChat();
  const queryClient = useQueryClient();
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const { data, isLoading, error, refetch } = useSecurityReview(selectedAppId);
  const [isRunningReview, setIsRunningReview] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsFinding, setDetailsFinding] =
    useState<SecurityReviewFinding | null>(null);
  const [isEditRulesOpen, setIsEditRulesOpen] = useState(false);
  const [rulesContent, setRulesContent] = useState("");
  const [fixingFindingKey, setFixingFindingKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFindings, setSelectedFindings] = useState<Set<string>>(
    new Set(),
  );
  const [isFixingSelected, setIsFixingSelected] = useState(false);
  const [selectedFixChat, setSelectedFixChat] = useState<{
    chatId: number;
    findings: SecurityFinding[];
  } | null>(null);
  const activeFixStreamChatIdsRef = useRef<Set<number>>(new Set());
  const selectionScope = `${selectedAppId ?? "no-app"}:${data?.chatId ?? "no-review"}`;
  const previousSelectionScopeRef = useRef(selectionScope);

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

  // Fix-chat metadata updates also refetch this query. Only a different app or
  // review should discard the selection for the review currently being fixed.
  useEffect(() => {
    if (previousSelectionScopeRef.current !== selectionScope) {
      setSelectedFindings(new Set());
      setSelectedFixChat(null);
      previousSelectionScopeRef.current = selectionScope;
    }
  }, [selectionScope]);

  const handleSaveRules = async () => {
    if (!selectedAppId) {
      showError("No app selected");
      return;
    }

    try {
      setIsSaving(true);
      const { warning } = await ipc.app.editAppFile({
        appId: selectedAppId,
        filePath: "SECURITY_RULES.md",
        content: rulesContent,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.versions.list({ appId: selectedAppId }),
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

  const openFindingDetails = (finding: SecurityReviewFinding) => {
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
      const chatId = await ipc.chat.createChat(selectedAppId);

      // Select the new chat (updates session/recent tracking and navigates)
      setIsChatPanelHidden(false);
      selectChat({ chatId, appId: selectedAppId });
      queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });

      // Stream the security review prompt
      await streamMessage({
        prompt: "/security-review",
        chatId,
        appId: selectedAppId,
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

  const showFixChat = (chatId: number) => {
    if (!selectedAppId) {
      showError("No app selected");
      return;
    }
    setIsChatPanelHidden(false);
    selectChat({ chatId, appId: selectedAppId });
  };

  const streamFixPrompt = async ({
    chatId,
    findingsToFix,
    setFixing,
    onFixSettled,
  }: {
    chatId: number;
    findingsToFix: SecurityFinding[];
    setFixing: (fixing: boolean) => void;
    onFixSettled?: () => void;
  }) => {
    if (!selectedAppId || activeFixStreamChatIdsRef.current.has(chatId)) {
      return;
    }

    setFixing(true);
    showFixChat(chatId);
    activeFixStreamChatIdsRef.current.add(chatId);
    try {
      await streamMessage({
        prompt: buildFixPrompt(findingsToFix),
        chatId,
        appId: selectedAppId,
        onSettled: () => {
          activeFixStreamChatIdsRef.current.delete(chatId);
          setFixing(false);
          onFixSettled?.();
        },
      });
    } catch (err) {
      activeFixStreamChatIdsRef.current.delete(chatId);
      showError(`Failed to run fix: ${err}`);
      setFixing(false);
    }
  };

  // Opens the fix chat for the given findings, creating it (and sending the
  // fix prompt) only if one doesn't already exist for this review + findings.
  const openFixChat = async ({
    findingsToFix,
    setFixing,
    onFixSettled,
  }: {
    findingsToFix: SecurityFinding[];
    setFixing: (fixing: boolean) => void;
    onFixSettled?: () => void;
  }): Promise<{ chatId: number; created: boolean } | null> => {
    if (!selectedAppId) {
      showError("No app selected");
      return null;
    }
    if (!data) {
      showError("No security review loaded");
      return null;
    }
    if (findingsToFix.length === 0) {
      showError("No valid issues selected");
      return null;
    }

    setFixing(true);
    try {
      const { chatId, created } = await ipc.security.getOrCreateSecurityFixChat(
        {
          appId: selectedAppId,
          reviewChatId: data.chatId,
          findings: findingsToFix,
        },
      );

      showFixChat(chatId);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.securityReview.byApp({ appId: selectedAppId }),
      });

      if (created) {
        queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
        await streamFixPrompt({
          chatId,
          findingsToFix,
          setFixing,
          onFixSettled,
        });
      } else {
        setFixing(false);
      }
      return { chatId, created };
    } catch (err) {
      showError(`Failed to create fix chat: ${err}`);
      setFixing(false);
      return null;
    }
  };

  const handleFixIssue = async (finding: SecurityFinding) => {
    const key = createFindingKey(finding);
    await openFixChat({
      findingsToFix: [finding],
      setFixing: (fixing) => {
        setFixingFindingKey(fixing ? key : null);
      },
    });
  };

  const handleShowFix = (finding: SecurityReviewFinding) => {
    if (finding.fixChatId) {
      showFixChat(finding.fixChatId);
      toast.info("Opened fix chat");
    }
  };

  const handleRerunFix = async (finding: SecurityReviewFinding) => {
    if (!finding.fixChatId) {
      return;
    }
    const key = createFindingKey(finding);
    await streamFixPrompt({
      chatId: finding.fixChatId,
      findingsToFix: [finding],
      setFixing: (fixing) => {
        setFixingFindingKey(fixing ? key : null);
      },
    });
  };

  const handleToggleSelection = (findingKey: string) => {
    setSelectedFixChat(null);
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

    setSelectedFixChat(null);

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
    if (!selectedAppId) {
      showError("No app selected");
      return;
    }
    if (!data?.findings) {
      showError("No security review loaded");
      return;
    }

    const findingsToFix =
      selectedFindings.size > 0
        ? data.findings.filter((finding) =>
            selectedFindings.has(createFindingKey(finding)),
          )
        : data.findings;
    if (findingsToFix.length === 0) {
      showError("No valid issues selected");
      return;
    }

    const result = await openFixChat({
      findingsToFix,
      setFixing: setIsFixingSelected,
      onFixSettled: () => {
        setSelectedFindings(new Set());
      },
    });
    if (result) {
      setSelectedFixChat({ chatId: result.chatId, findings: findingsToFix });
    }
  };

  const handleShowSelectedFix = () => {
    if (!selectedFixChat) {
      return;
    }
    showFixChat(selectedFixChat.chatId);
    toast.info("Opened fix chat");
  };

  const handleRerunSelectedFix = async () => {
    if (!selectedFixChat) {
      return;
    }
    await streamFixPrompt({
      chatId: selectedFixChat.chatId,
      findingsToFix: selectedFixChat.findings,
      setFixing: setIsFixingSelected,
    });
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
          onShowSelectedFix={handleShowSelectedFix}
          onRerunSelectedFix={handleRerunSelectedFix}
          isFixingSelected={isFixingSelected}
          selectedFixCount={selectedFixChat?.findings.length}
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
            onShowFix={handleShowFix}
            onRerunFix={handleRerunFix}
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
          onShowFix={handleShowFix}
          onRerunFix={handleRerunFix}
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
              <DialogClose
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                Cancel
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
