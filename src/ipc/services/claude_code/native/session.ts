import type { ClaudeSessionManifest } from "../usage_checkpoint";

/** Ledger entries kept per chat; older turns can no longer be rewound to and
 * fall back to a fresh session. */
export const MAX_LEDGER_ENTRIES = 200;

export interface ClaudeSessionPlan {
  /** Resume an existing CLI session instead of starting a new one. */
  resume: boolean;
  /** Session id to pass to the CLI (`--resume` or `--session-id`). */
  sessionId: string;
  /** Rewind: resume only up to this CLI assistant uuid, in a fork. */
  resumeAt?: string;
  /** Whether this session uses continuity rules from now on. */
  continuity: boolean;
  /** Why a resumable session was not resumed as-is (diagnostics only). */
  reason?: "rewind" | "interrupted" | "changed" | "rewound-too-far";
}

/**
 * Decide how a Claude Code turn continues its CLI session.
 *
 * Strict sessions (the original behavior) resume only when the app, the
 * system prompt and the tool schemas are unchanged. Continuity sessions
 * (native tools enabled now, or at any point in this session) resume across
 * prompt, tool and mode changes; only the app must match. When Dyad's history
 * no longer contains the message the session last answered (undo, restore,
 * retry), a continuity session is rewound to the newest remaining message it
 * knows about.
 */
export function planClaudeSession({
  chat,
  manifest,
  strictFingerprint,
  appFingerprint,
  continuityRequested,
  assistantMessageIds,
  newSessionId,
}: {
  chat: { claudeSessionId: string | null; claudeSessionState: string | null };
  manifest: Partial<ClaudeSessionManifest>;
  strictFingerprint: string;
  appFingerprint: string;
  /** Native tools are enabled for this user. */
  continuityRequested: boolean;
  /** Ids of this chat's assistant messages before the current turn, oldest
   * first. */
  assistantMessageIds: readonly number[];
  newSessionId: () => string;
}): ClaudeSessionPlan {
  const continuity = continuityRequested || manifest.continuity === true;
  const fresh = (reason?: ClaudeSessionPlan["reason"]): ClaudeSessionPlan => ({
    resume: false,
    sessionId: newSessionId(),
    continuity,
    ...(reason ? { reason } : {}),
  });
  const resumable =
    chat.claudeSessionState === "ready" &&
    !!chat.claudeSessionId &&
    chat.claudeSessionId === manifest.sessionId &&
    manifest.usageBaseline !== undefined;
  if (!resumable)
    return fresh(chat.claudeSessionId ? "interrupted" : undefined);
  const matches = continuity
    ? manifest.appFingerprint === appFingerprint
    : manifest.fingerprint === strictFingerprint;
  if (!matches) return fresh("changed");
  const sessionId = chat.claudeSessionId!;
  if (
    !continuity ||
    manifest.lastMessageId === undefined ||
    assistantMessageIds.includes(manifest.lastMessageId)
  )
    return { resume: true, sessionId, continuity };
  // The session answered a message that is gone: rewind to the newest
  // remaining message the session knows about.
  const ledger = manifest.ledger ?? {};
  for (let i = assistantMessageIds.length - 1; i >= 0; i--) {
    const uuid = ledger[String(assistantMessageIds[i])];
    if (uuid)
      return {
        resume: true,
        sessionId,
        resumeAt: uuid,
        continuity,
        reason: "rewind",
      };
  }
  return fresh("rewound-too-far");
}

/** Record that `messageId` was answered, ending at CLI assistant `uuid`. */
export function recordLedgerEntry(
  ledger: Record<string, string> | undefined,
  messageId: number,
  uuid: string | undefined,
): Record<string, string> {
  const next = { ...ledger };
  if (uuid) next[String(messageId)] = uuid;
  const keys = Object.keys(next).sort((a, b) => Number(a) - Number(b));
  for (const key of keys.slice(
    0,
    Math.max(0, keys.length - MAX_LEDGER_ENTRIES),
  ))
    delete next[key];
  return next;
}
