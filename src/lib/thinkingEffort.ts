import type { UserSettings } from "@/lib/schemas";

export type ThinkingEffortLevel = NonNullable<UserSettings["thinkingBudget"]>;

export const THINKING_EFFORT_DEFAULT: ThinkingEffortLevel = "medium";

export interface ThinkingEffortOption {
  value: ThinkingEffortLevel;
  /** Short label shown in the pill trigger and menu rows. */
  label: string;
  /** One-line explanation shown beneath the label. */
  description: string;
}

export const THINKING_EFFORT_OPTIONS: ThinkingEffortOption[] = [
  {
    value: "low",
    label: "Low",
    description: "Faster, cheaper",
  },
  {
    value: "medium",
    label: "Medium",
    description: "Balanced",
  },
  {
    value: "high",
    label: "High",
    description: "Deeper reasoning",
  },
  {
    value: "xhigh",
    label: "X-High",
    description: "Maximum reasoning",
  },
];

const DEFAULT_OPTION =
  THINKING_EFFORT_OPTIONS.find(
    (opt) => opt.value === THINKING_EFFORT_DEFAULT,
  ) ?? THINKING_EFFORT_OPTIONS[1];

export function getThinkingEffortOption(
  value: ThinkingEffortLevel | undefined,
): ThinkingEffortOption {
  return (
    THINKING_EFFORT_OPTIONS.find((opt) => opt.value === value) ?? DEFAULT_OPTION
  );
}
