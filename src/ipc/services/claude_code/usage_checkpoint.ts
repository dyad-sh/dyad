import { z } from "zod";
import { writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const counters = z.object({
  inputTokens: count,
  outputTokens: count,
  cacheReadInputTokens: count,
  cacheCreationInputTokens: count,
});
export const ClaudeUsageBaselineSchema = z.record(z.string(), counters);
export type ClaudeUsageBaseline = z.infer<typeof ClaudeUsageBaselineSchema>;
export const ClaudeSessionManifestSchema = z.object({
  sessionId: z.string(),
  fingerprint: z.string(),
  usageBaseline: ClaudeUsageBaselineSchema.optional(),
  /** Fingerprint of the app alone. Continuity sessions resume across prompt
   * and tool changes, so only the app identity must match. */
  appFingerprint: z.string().optional(),
  /** Set once a session served a turn with native tools enabled; it keeps
   * resuming across harness and mode changes from then on. */
  continuity: z.boolean().optional(),
  /** Dyad assistant message id → last top-level CLI assistant uuid of that
   * turn. Used to rewind the session after undo, restore or retry. */
  ledger: z.record(z.string(), z.string()).optional(),
  /** The Dyad assistant message the session last answered. */
  lastMessageId: z.number().int().optional(),
});
export type ClaudeSessionManifest = z.infer<typeof ClaudeSessionManifestSchema>;

/** modelUsage survives CLI --resume; subtract all four counters per model. */
export function claudeUsageDelta(
  result: unknown,
  previous: ClaudeUsageBaseline,
) {
  const parsed = z
    .object({
      modelUsage: ClaudeUsageBaselineSchema,
      usage: z.unknown().optional(),
    })
    .parse(result);
  const baseline = ClaudeUsageBaselineSchema.parse(previous);
  for (const model of Object.keys(baseline)) {
    if (!Object.prototype.hasOwnProperty.call(parsed.modelUsage, model))
      throw new Error("Claude cumulative usage lost a model");
  }
  const modelUsage = Object.fromEntries(
    Object.entries(parsed.modelUsage).map(([model, current]) => {
      const prior = baseline[model];
      const delta = {
        inputTokens: current.inputTokens - (prior?.inputTokens ?? 0),
        outputTokens: current.outputTokens - (prior?.outputTokens ?? 0),
        cacheReadInputTokens:
          current.cacheReadInputTokens - (prior?.cacheReadInputTokens ?? 0),
        cacheCreationInputTokens:
          current.cacheCreationInputTokens -
          (prior?.cacheCreationInputTokens ?? 0),
      };
      return [model, counters.parse(delta)];
    }),
  );
  return {
    baseline: parsed.modelUsage,
    result: { modelUsage, usage: parsed.usage },
  };
}

/** Replace the whole manifest atomically so an interrupted write cannot resume
 * a session with a stale or truncated billing baseline. */
export async function writeClaudeSessionManifest(
  manifestPath: string,
  manifest: ClaudeSessionManifest,
) {
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(manifest), { mode: 0o600 });
    await rename(temporaryPath, manifestPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
