import React from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { CheckCircle2, CircleX, Loader2 } from "lucide-react";

import {
  currentTurnSubagentRunsAtom,
  openSubagentPanelAtom,
  type SubagentRun,
} from "@/atoms/subagentAtoms";
import { getSubagentDescriptor } from "./registry";

function chipSnippet(run: SubagentRun): string {
  if (run.status === "running") {
    const lastStep = run.steps[run.steps.length - 1];
    return lastStep ? lastStep.summary : "starting…";
  }
  if (run.status === "error") {
    return run.output?.summary ?? "failed";
  }
  if (run.status === "aborted") {
    return "did not finish";
  }
  return run.output?.summary ?? "done";
}

function SubagentChip({ run }: { run: SubagentRun }) {
  const openPanel = useSetAtom(openSubagentPanelAtom);
  const descriptor = getSubagentDescriptor(run.type);
  const Icon = descriptor.icon;

  return (
    <button
      type="button"
      data-testid="subagent-chip"
      onClick={() => openPanel(run.key)}
      className="inline-flex items-center gap-1.5 max-w-72 px-2 py-1 rounded-full border border-border bg-(--background-lightest) hover:bg-(--background-lighter) text-xs transition-colors cursor-pointer"
      title={`${descriptor.label}: ${run.title}`}
    >
      {run.status === "running" ? (
        <Loader2 size={12} className="animate-spin text-amber-500 shrink-0" />
      ) : run.status === "completed" ? (
        <CheckCircle2 size={12} className="text-green-600 shrink-0" />
      ) : (
        <CircleX size={12} className="text-red-500 shrink-0" />
      )}
      <Icon size={12} className="text-muted-foreground shrink-0" />
      <span className="font-medium shrink-0">{descriptor.label}</span>
      <span className="text-muted-foreground truncate">
        · {chipSnippet(run)}
      </span>
    </button>
  );
}

/**
 * Strip above the chat input showing this turn's sub-agent runs. Running
 * chips show the latest step; completed chips linger (with their result)
 * until the turn's stream ends. Clicking a chip opens the Agents panel.
 */
export const ActiveSubagentsBar: React.FC = () => {
  const runs = useAtomValue(currentTurnSubagentRunsAtom);
  if (runs.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap px-2 py-1.5 border-b border-border"
      data-testid="active-subagents-bar"
    >
      {runs.map((run) => (
        <SubagentChip key={run.key} run={run} />
      ))}
    </div>
  );
};
