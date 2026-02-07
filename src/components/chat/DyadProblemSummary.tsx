import React, { useState } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import type { Problem } from "@/ipc/types";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadExpandIcon,
  DyadCardContent,
} from "./DyadCardPrimitives";

type ProblemWithoutSnippet = Omit<Problem, "snippet">;

interface DyadProblemSummaryProps {
  summary?: string;
  children?: React.ReactNode;
}

interface ProblemItemProps {
  problem: ProblemWithoutSnippet;
  index: number;
}

const ProblemItem: React.FC<ProblemItemProps> = ({ problem, index }) => {
  return (
    <div className="flex items-start gap-3 py-2 px-3 border-b border-border/40 last:border-b-0">
      <div className="flex-shrink-0 size-6 rounded-full bg-muted/60 flex items-center justify-center mt-0.5">
        <span className="text-[11px] font-semibold text-muted-foreground">
          {index + 1}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <FileText size={13} className="text-muted-foreground shrink-0" />
          <span className="text-sm font-medium text-foreground truncate">
            {problem.file}
          </span>
          <span className="text-[11px] text-muted-foreground font-mono">
            {problem.line}:{problem.column}
          </span>
          <span className="text-[11px] bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground font-mono">
            TS{problem.code}
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {problem.message}
        </p>
      </div>
    </div>
  );
};

export const DyadProblemSummary: React.FC<DyadProblemSummaryProps> = ({
  summary,
  children,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);

  // Parse problems from children content if available
  const problems: ProblemWithoutSnippet[] = React.useMemo(() => {
    if (!children || typeof children !== "string") return [];

    const problemTagRegex =
      /<problem\s+file="([^"]+)"\s+line="(\d+)"\s+column="(\d+)"\s+code="(\d+)">([^<]+)<\/problem>/g;
    const problems: ProblemWithoutSnippet[] = [];
    let match;

    while ((match = problemTagRegex.exec(children)) !== null) {
      try {
        problems.push({
          file: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          message: match[5].trim(),
          code: parseInt(match[4], 10),
        });
      } catch {
        return [
          {
            file: "unknown",
            line: 0,
            column: 0,
            message: children,
            code: 0,
          },
        ];
      }
    }

    return problems;
  }, [children]);

  const totalProblems = problems.length;
  const displaySummary =
    summary || `${totalProblems} problems found (TypeScript errors)`;

  return (
    <DyadCard
      accentColor="amber"
      isExpanded={isContentVisible}
      onClick={() => setIsContentVisible(!isContentVisible)}
      data-testid="problem-summary"
    >
      <DyadCardHeader icon={<AlertTriangle size={15} />} accentColor="amber">
        <DyadBadge color="amber">Auto-fix</DyadBadge>
        <span className="font-medium text-sm text-foreground truncate">
          {displaySummary}
        </span>
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>

      {/* Content area - show individual problems */}
      <DyadCardContent isExpanded={isContentVisible}>
        {totalProblems > 0 ? (
          <div className="bg-muted/20 rounded-lg border border-border/40 overflow-hidden">
            {problems.map((problem, index) => (
              <ProblemItem
                key={`${problem.file}-${problem.line}-${problem.column}-${index}`}
                problem={problem}
                index={index}
              />
            ))}
          </div>
        ) : (
          children && (
            <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/20 p-3 rounded-lg text-muted-foreground">
              {children}
            </pre>
          )
        )}
      </DyadCardContent>
    </DyadCard>
  );
};
