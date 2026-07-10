import type { ReactNode } from "react";
import { Bot, ScanSearch, type LucideIcon } from "lucide-react";

import type { DyadAccentColor } from "@/components/chat/DyadCardPrimitives";
import { isExplorerOutputData } from "@/shared/subagent_types";
import { ExplorerOutput } from "./ExplorerOutput";

/**
 * Per-agent-type presentation for sub-agent runs. Adding a new sub-agent's UI
 * is one entry here (plus an optional rich output renderer) — the chat card,
 * chips bar, Agents panel, streaming, and persistence are all shared.
 */
export interface SubagentDescriptor {
  /** Human label, e.g. "Explorer". */
  label: string;
  /** Short uppercase badge, e.g. "EXPLORER". */
  badge: string;
  icon: LucideIcon;
  accentColor: DyadAccentColor;
  /** Rich renderer for the run's structured output. Return null to fall back. */
  renderOutput?: (data: unknown) => ReactNode | null;
}

const DEFAULT_DESCRIPTOR: SubagentDescriptor = {
  label: "Agent",
  badge: "AGENT",
  icon: Bot,
  accentColor: "slate",
};

const REGISTRY: Record<string, SubagentDescriptor> = {
  "code-explorer": {
    label: "Explorer",
    badge: "EXPLORER",
    icon: ScanSearch,
    accentColor: "teal",
    renderOutput: (data) =>
      isExplorerOutputData(data) ? <ExplorerOutput data={data} /> : null,
  },
};

export function getSubagentDescriptor(type: string): SubagentDescriptor {
  return REGISTRY[type] ?? DEFAULT_DESCRIPTOR;
}
