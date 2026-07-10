import React, { useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Bot, ChevronRight } from "lucide-react";

import {
  selectedSubagentRunKeyAtom,
  subagentRunsAtom,
  type SubagentRun,
} from "@/atoms/subagentAtoms";
import { DyadStateIndicator } from "@/components/chat/DyadCardPrimitives";
import type { CustomTagState } from "@/components/chat/stateTypes";
import { getSubagentDescriptor } from "@/components/subagents/registry";
import { cn } from "@/lib/utils";

function stateForRun(run: SubagentRun): CustomTagState {
  switch (run.status) {
    case "running":
      return "pending";
    case "completed":
      return "finished";
    case "error":
      return "error";
    default:
      return "aborted";
  }
}

function RunListItem({
  run,
  isSelected,
  onSelect,
}: {
  run: SubagentRun;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const descriptor = getSubagentDescriptor(run.type);
  const Icon = descriptor.icon;
  return (
    <button
      type="button"
      data-testid="agents-panel-run"
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 text-left text-sm rounded-lg transition-colors cursor-pointer",
        isSelected
          ? "bg-(--background-lighter)"
          : "hover:bg-(--background-lightest)",
      )}
    >
      <Icon size={14} className="text-muted-foreground shrink-0" />
      <span className="font-medium shrink-0">{descriptor.label}</span>
      <span className="text-muted-foreground truncate flex-1 min-w-0">
        {run.title}
      </span>
      <DyadStateIndicator
        state={stateForRun(run)}
        pendingLabel="Running"
        abortedLabel="Aborted"
        errorLabel="Failed"
      />
    </button>
  );
}

function StepRow({
  index,
  summary,
  detail,
  isError,
}: {
  index: number;
  summary: string;
  detail?: string;
  isError: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const expandable = !!detail;
  return (
    <li className="flex flex-col">
      <button
        type="button"
        className={cn(
          "flex items-start gap-2 text-left text-xs py-1 rounded-md",
          expandable && "cursor-pointer hover:bg-(--background-lightest)",
        )}
        onClick={expandable ? () => setIsExpanded(!isExpanded) : undefined}
      >
        <span className="text-muted-foreground w-5 text-right shrink-0">
          {index}
        </span>
        <span
          className={cn(
            "flex-1 min-w-0 break-words font-mono text-[11px]",
            isError ? "text-red-500" : "text-foreground/90",
          )}
        >
          {summary}
        </span>
        {expandable && (
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 mt-0.5 text-muted-foreground transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        )}
      </button>
      {isExpanded && detail && (
        <pre className="ml-7 my-1 p-2 rounded-md bg-(--background-lightest) text-[10px] text-muted-foreground whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
          {detail}
        </pre>
      )}
    </li>
  );
}

function RunDetail({ run }: { run: SubagentRun }) {
  const descriptor = getSubagentDescriptor(run.type);
  const Icon = descriptor.icon;
  const richOutput = run.output
    ? (descriptor.renderOutput?.(run.output.data) ?? null)
    : null;

  return (
    <div className="flex flex-col gap-4 p-3" data-testid="agents-panel-detail">
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={16} className="text-muted-foreground shrink-0" />
        <span className="font-medium text-sm truncate flex-1 min-w-0">
          {run.title || descriptor.label}
        </span>
        <DyadStateIndicator
          state={stateForRun(run)}
          pendingLabel="Running…"
          abortedLabel="Did not finish"
          errorLabel="Failed"
          finishedLabel={run.output?.summary}
        />
      </div>

      <section>
        <h3 className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-1">
          Steps {run.steps.length > 0 && `(${run.steps.length})`}
        </h3>
        {run.steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {run.status === "running" ? "Starting…" : "No steps recorded."}
          </p>
        ) : (
          <ol className="flex flex-col">
            {run.steps.map((step) => (
              <StepRow
                key={step.index}
                index={step.index}
                summary={step.summary}
                detail={step.detail}
                isError={step.status === "error"}
              />
            ))}
          </ol>
        )}
      </section>

      {(richOutput || run.output) && (
        <section>
          <h3 className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-1.5">
            Output
          </h3>
          {richOutput ?? (
            <p className="text-xs text-foreground/90">{run.output?.summary}</p>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Right-side "Agents" panel: a run list (newest first, live runs pinned) and
 * a detail view with the selected run's step timeline and structured output.
 */
export function AgentsPanel() {
  const runs = useAtomValue(subagentRunsAtom);
  const [selectedKey, setSelectedKey] = useAtom(selectedSubagentRunKeyAtom);
  const selectedRun =
    runs.find((run) => run.key === selectedKey) ?? runs[0] ?? null;

  if (runs.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-2 text-center p-6"
        data-testid="agents-panel-empty"
      >
        <Bot size={24} className="text-muted-foreground" />
        <p className="text-sm font-medium">No agent runs in this chat yet</p>
        <p className="text-xs text-muted-foreground max-w-64">
          When the assistant delegates work to a sub-agent (like the Code
          Explorer), its steps and results will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="agents-panel">
      <div className="border-b border-border p-1.5 max-h-48 overflow-y-auto shrink-0">
        {runs.map((run) => (
          <RunListItem
            key={run.key}
            run={run}
            isSelected={selectedRun?.key === run.key}
            onSelect={() => setSelectedKey(run.key)}
          />
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {selectedRun && <RunDetail run={selectedRun} />}
      </div>
    </div>
  );
}
