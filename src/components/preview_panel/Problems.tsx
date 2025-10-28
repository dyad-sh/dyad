import { useEffect, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  AlertTriangle,
  XCircle,
  FileText,
  Wrench,
  RefreshCw,
  Check,
} from "lucide-react";
import { Problem, ProblemReport } from "@/ipc/ipc_types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { useStreamChat } from "@/hooks/useStreamChat";
import { useCheckProblems } from "@/hooks/useCheckProblems";
import { createProblemFixPrompt } from "@/shared/problem_prompt";
import { showError } from "@/lib/toast";

interface ProblemItemProps {
  problem: Problem;
  checked: boolean;
  onToggle: () => void;
}

const ProblemItem = ({ problem, checked, onToggle }: ProblemItemProps) => {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="cursor-pointer flex items-start gap-3 p-3 border-b border-border hover:bg-[var(--background-darker)] dark:hover:bg-[var(--background-lightest)] transition-colors"
      data-testid="problem-row"
    >
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5"
        aria-label="Select problem"
      />
      <div className="flex-shrink-0 mt-0.5">
        <XCircle size={16} className="text-red-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <FileText size={14} className="text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium truncate">{problem.file}</span>

          <span className="text-xs text-muted-foreground">
            {problem.line}:{problem.column}
          </span>
        </div>
        <p className="text-sm text-foreground leading-relaxed">
          {problem.message}
        </p>
      </div>
    </div>
  );
};

interface RecheckButtonProps {
  appId: number;
  size?: "sm" | "default" | "lg";
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  className?: string;
  onBeforeRecheck?: () => void;
}

const RecheckButton = ({
  appId,
  size = "sm",
  variant = "outline",
  className = "h-7 px-3 text-xs",
  onBeforeRecheck,
}: RecheckButtonProps) => {
  const { checkProblems, isChecking } = useCheckProblems(appId);
  const [showingFeedback, setShowingFeedback] = useState(false);

  const handleRecheck = async () => {
    if (onBeforeRecheck) {
      onBeforeRecheck();
    }
    setShowingFeedback(true);

    const res = await checkProblems();

    setShowingFeedback(false);

    if (res.error) {
      showError(res.error);
    }
  };

  const isShowingChecking = isChecking || showingFeedback;

  return (
    <Button
      size={size}
      variant={variant}
      onClick={handleRecheck}
      disabled={isShowingChecking}
      className={className}
      data-testid="recheck-button"
    >
      <RefreshCw
        size={14}
        className={`mr-1 ${isShowingChecking ? "animate-spin" : ""}`}
      />
      {isShowingChecking ? "Checking..." : "Run checks"}
    </Button>
  );
};

interface ProblemsSummaryProps {
  problemReport: ProblemReport;
  appId: number;
  selectedCount: number;
  onClearAll: () => void;
  onFixSelected: () => void;
  onSelectAll: () => void;
}

const ProblemsSummary = ({
  problemReport,
  appId,
  selectedCount,
  onClearAll,
  onFixSelected,
  onSelectAll,
}: ProblemsSummaryProps) => {
  const { problems } = problemReport;
  const totalErrors = problems.length;

  // Keep stream hook mounted; actual fix action is provided via onFixSelected

  if (problems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center">
        <p className="mt-6 text-sm font-medium text-muted-foreground mb-3">
          No problems found
        </p>
        <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mb-3">
          <Check size={20} className="text-green-600 dark:text-green-400" />
        </div>

        <RecheckButton appId={appId} />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-[var(--background-darkest)] border-b border-border">
      <div className="flex items-center gap-4">
        {totalErrors > 0 && (
          <div className="flex items-center gap-2">
            <XCircle size={16} className="text-red-500" />
            <span className="text-sm font-medium">
              {totalErrors} {totalErrors === 1 ? "error" : "errors"}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <RecheckButton appId={appId} onBeforeRecheck={onClearAll} />
        {selectedCount === 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onSelectAll}
            className="h-7 px-3 text-xs"
          >
            Select all
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={onClearAll}
            className="h-7 px-3 text-xs"
          >
            Clear all
          </Button>
        )}
        <Button
          size="sm"
          variant="default"
          onClick={onFixSelected}
          className="h-7 px-3 text-xs"
          data-testid="fix-all-button"
          disabled={selectedCount === 0}
        >
          <Wrench size={14} className="mr-1" />
          {`Fix ${selectedCount} ${selectedCount === 1 ? "problem" : "problems"}`}
        </Button>
      </div>
    </div>
  );
};

export function Problems() {
  return (
    <div data-testid="problems-pane">
      <_Problems />
    </div>
  );
}

export function _Problems() {
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { problemReport } = useCheckProblems(selectedAppId);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const problemKey = (p: Problem) =>
    `${p.file}:${p.line}:${p.column}:${p.code}`;
  const { streamMessage } = useStreamChat();
  const [selectedChatId] = useAtom(selectedChatIdAtom);

  // Whenever the problems pane is shown or the report updates, select all problems
  useEffect(() => {
    if (problemReport?.problems?.length) {
      setSelectedKeys(new Set(problemReport.problems.map(problemKey)));
    } else {
      setSelectedKeys(new Set());
    }
  }, [problemReport]);

  if (!selectedAppId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-[var(--background-darkest)] flex items-center justify-center mb-4">
          <AlertTriangle size={24} className="text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium mb-2">No App Selected</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          Select an app to view TypeScript problems and diagnostic information.
        </p>
      </div>
    );
  }

  if (!problemReport) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 rounded-full bg-[var(--background-darkest)] flex items-center justify-center mb-4">
          <AlertTriangle size={24} className="text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium mb-2">No Problems Report</h3>
        <p className="text-sm text-muted-foreground max-w-md mb-4">
          Run checks to scan your app for TypeScript errors and other problems.
        </p>
        <RecheckButton
          appId={selectedAppId}
          onBeforeRecheck={() => setSelectedKeys(new Set())}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ProblemsSummary
        problemReport={problemReport}
        appId={selectedAppId}
        selectedCount={
          [...selectedKeys].filter((key) =>
            problemReport.problems.some((p) => problemKey(p) === key),
          ).length
        }
        onClearAll={() => setSelectedKeys(new Set())}
        onSelectAll={() =>
          setSelectedKeys(
            new Set(problemReport.problems.map((p) => problemKey(p))),
          )
        }
        onFixSelected={() => {
          if (!selectedChatId) return;
          const selectedProblems = problemReport.problems.filter((p) =>
            selectedKeys.has(problemKey(p)),
          );
          const subsetReport: ProblemReport = { problems: selectedProblems };
          streamMessage({
            prompt: createProblemFixPrompt(subsetReport),
            chatId: selectedChatId,
          });
        }}
      />
      <div className="flex-1 overflow-y-auto">
        {problemReport.problems.map((problem) => {
          const selKey = problemKey(problem);
          const checked = selectedKeys.has(selKey);
          return (
            <ProblemItem
              key={selKey}
              problem={problem}
              checked={checked}
              onToggle={() => {
                setSelectedKeys((prev) => {
                  const next = new Set(prev);
                  if (next.has(selKey)) {
                    next.delete(selKey);
                  } else {
                    next.add(selKey);
                  }
                  return next;
                });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
