export const DEAL_STAGES = ["lead", "qualified", "proposal", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export function isDealStage(value: unknown): value is DealStage {
  return typeof value === "string" && (DEAL_STAGES as readonly string[]).includes(value);
}
