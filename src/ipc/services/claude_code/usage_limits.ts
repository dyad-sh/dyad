import { z } from "zod";
import type { ClaudeCodeUsage } from "@/shared/claude_code_usage";

const WindowSchema = z.object({
  utilization: z.number().finite().min(0).max(1),
  resetsAt: z.number().finite().positive().max(8_640_000_000_000),
});
const EventSchema = z.object({
  type: z.literal("rate_limit_event"),
  rate_limit_info: z.object({
    unifiedWindows: z.record(z.string(), z.unknown()),
  }),
});

let account: string | null = null;
let generation = 0;
let cached: ClaudeCodeUsage = { windows: [], updatedAt: null };

// Only a private account identity from `claude auth status`, never credentials.
export function setClaudeUsageAccount(identity: string | null) {
  if (account === identity) return;
  account = identity;
  generation++;
  cached = { windows: [], updatedAt: null };
}

export function claudeUsageGeneration() {
  return generation;
}

export function recordClaudeUsageLimits(
  event: unknown,
  turnGeneration: number,
) {
  if (turnGeneration !== generation || account === null) return;
  // unifiedWindows is an undocumented CLI extension: missing/invalid fields
  // must never fail a turn or be interpreted as zero usage.
  const parsed = EventSchema.safeParse(event);
  if (!parsed.success) return;
  const windows: ClaudeCodeUsage["windows"] = [];
  for (const name of ["five_hour", "seven_day"] as const) {
    const window = WindowSchema.safeParse(
      parsed.data.rate_limit_info.unifiedWindows[name],
    );
    if (window.success) {
      windows.push({
        name,
        usedPercent: window.data.utilization * 100,
        resetsAt: window.data.resetsAt * 1000,
      });
    }
  }
  if (windows.length) cached = { windows, updatedAt: Date.now() };
}

export function getClaudeUsageLimits(): ClaudeCodeUsage {
  return {
    ...cached,
    // After a reset we don't know the new usage; don't invent a zero value.
    windows: cached.windows.filter((window) => window.resetsAt > Date.now()),
  };
}
