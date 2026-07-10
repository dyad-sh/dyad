import React, { useMemo } from "react";
import { useSetAtom } from "jotai";
import { ArrowUpRight } from "lucide-react";

import { openSubagentPanelAtom } from "@/atoms/subagentAtoms";
import {
  DyadBadge,
  DyadCard,
  DyadCardHeader,
  DyadStateIndicator,
} from "@/components/chat/DyadCardPrimitives";
import type { CustomTagState } from "@/components/chat/stateTypes";
import { parseSubagentEvents } from "@/shared/subagent_types";
import { getSubagentDescriptor } from "./registry";

interface SubagentCardProps {
  state: CustomTagState;
  attributes: Record<string, string>;
  content: string;
}

/**
 * Compact chat card for a sub-agent run. Shows the latest step while running
 * and a one-line result summary when done; clicking opens the Agents panel
 * deep-linked to this run (no inline expansion).
 */
export const SubagentCard: React.FC<SubagentCardProps> = ({
  state,
  attributes,
  content,
}) => {
  const openPanel = useSetAtom(openSubagentPanelAtom);
  const effectiveState: CustomTagState =
    attributes.status === "error" ? "error" : state;
  const descriptor = getSubagentDescriptor(attributes.type || "unknown");
  const Icon = descriptor.icon;

  const parsed = useMemo(() => parseSubagentEvents(content), [content]);
  const lastStep = parsed.steps[parsed.steps.length - 1];

  const inProgress = effectiveState === "pending";
  const subtitle = inProgress
    ? lastStep
      ? `step ${lastStep.index} · ${lastStep.summary}`
      : "starting…"
    : (parsed.output?.summary ??
      (effectiveState === "aborted" ? "did not finish" : ""));

  return (
    <DyadCard
      state={effectiveState}
      accentColor={descriptor.accentColor}
      onClick={() => openPanel(attributes["run-id"] || null)}
      data-testid="subagent-card"
    >
      <DyadCardHeader
        icon={<Icon size={15} />}
        accentColor={descriptor.accentColor}
      >
        <DyadBadge color={descriptor.accentColor}>{descriptor.badge}</DyadBadge>
        {attributes["app-name"] && (
          <DyadBadge color="sky">{attributes["app-name"]}</DyadBadge>
        )}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="font-medium text-sm text-foreground truncate">
            {attributes.title ? `"${attributes.title}"` : descriptor.label}
          </span>
          {subtitle && (
            <span
              className="text-xs text-muted-foreground truncate"
              data-testid="subagent-card-subtitle"
            >
              {subtitle}
            </span>
          )}
        </div>
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Running…" />
        )}
        {effectiveState === "aborted" && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        {effectiveState === "error" && (
          <DyadStateIndicator state="error" errorLabel="Failed" />
        )}
        <ArrowUpRight
          size={16}
          className="shrink-0 text-muted-foreground group-hover/card:text-foreground transition-colors"
        />
      </DyadCardHeader>
    </DyadCard>
  );
};
