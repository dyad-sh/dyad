import { db } from "../../db";
import { mcpToolConsents } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";
import crypto from "node:crypto";
import { safeSend } from "./safe_sender";
import { createUserInputResolver } from "./user_input_resolver";

export type Consent = "ask" | "always" | "denied";

type ConsentDecision = "accept-once" | "accept-always" | "decline";

const consentResolver = createUserInputResolver<ConsentDecision>({
  timeoutMs: 5 * 60 * 1000,
});

export function waitForConsent(
  requestId: string,
  chatId: number,
  abortSignal?: AbortSignal,
): Promise<ConsentDecision> {
  return consentResolver
    .wait(requestId, chatId, abortSignal)
    .then((decision) => decision ?? "decline");
}

export function resolveConsent(requestId: string, decision: ConsentDecision) {
  consentResolver.resolve(requestId, decision);
}

// Resolve any pending MCP consents for a chat as declined. Called when a stream
// is cancelled or ends so the tool calls unblock instead of hanging once their
// consent UI has been cleared.
export function clearPendingMcpConsentsForChat(chatId: number): void {
  consentResolver.abortChat(chatId);
}

export async function getStoredConsent(
  serverId: number,
  toolName: string,
): Promise<Consent> {
  const rows = await db
    .select()
    .from(mcpToolConsents)
    .where(
      and(
        eq(mcpToolConsents.serverId, serverId),
        eq(mcpToolConsents.toolName, toolName),
      ),
    );
  if (rows.length === 0) return "ask";
  return (rows[0].consent as Consent) ?? "ask";
}

export async function setStoredConsent(
  serverId: number,
  toolName: string,
  consent: Consent,
): Promise<void> {
  const rows = await db
    .select()
    .from(mcpToolConsents)
    .where(
      and(
        eq(mcpToolConsents.serverId, serverId),
        eq(mcpToolConsents.toolName, toolName),
      ),
    );
  if (rows.length > 0) {
    await db
      .update(mcpToolConsents)
      .set({ consent })
      .where(
        and(
          eq(mcpToolConsents.serverId, serverId),
          eq(mcpToolConsents.toolName, toolName),
        ),
      );
  } else {
    await db.insert(mcpToolConsents).values({ serverId, toolName, consent });
  }
}

// Result of the auto-approve hook: whether the classifier auto-approved, plus
// its one-sentence reason (shown to the user on either path).
export interface McpAutoApproveResult {
  approved: boolean;
  reason?: string;
}

// Result of a consent check. autoApprovedReason is set only when the classifier
// auto-approved, so the caller can surface it on the tool-call card.
export interface McpConsentResult {
  approved: boolean;
  autoApprovedReason?: string;
}

export async function requireMcpToolConsent(
  event: IpcMainInvokeEvent,
  params: {
    serverId: number;
    serverName: string;
    toolName: string;
    toolDescription?: string | null;
    inputPreview?: string | null;
    chatId: number;
    // Optional auto-approve hook (agent mode, Pro). Runs only on the "ask"
    // path, so explicit always/denied choices still win.
    autoApprove?: () => Promise<McpAutoApproveResult>;
    abortSignal?: AbortSignal;
  },
): Promise<McpConsentResult> {
  const current = await getStoredConsent(params.serverId, params.toolName);
  if (current === "always") return { approved: true };
  if (current === "denied") return { approved: false };

  // Strip the non-serializable callback before sending over IPC.
  const { autoApprove, abortSignal, ...serializableParams } = params;
  const requestId = `${params.serverId}:${params.toolName}:${crypto.randomUUID()}`;
  // Some of these sends fire after an await, so guard against a renderer that
  // was destroyed (window closed, e2e teardown) in the meantime.
  const send = (channel: string, payload: Record<string, unknown>) =>
    safeSend(event.sender, channel, payload);

  const finalize = async (
    response: ConsentDecision,
  ): Promise<McpConsentResult> => {
    if (response === "accept-always") {
      await setStoredConsent(params.serverId, params.toolName, "always");
      return { approved: true };
    }
    return { approved: response === "accept-once" };
  };

  // No classifier: show the prompt and wait for the user.
  if (!autoApprove) {
    send("mcp:tool-consent-request", { requestId, ...serializableParams });
    const response = await waitForConsent(
      requestId,
      params.chatId,
      abortSignal,
    );
    send("mcp:tool-consent-resolved", { requestId });
    return finalize(response);
  }

  // Classifier active: show the prompt immediately with a spinner and race the
  // classifier against the user. The user can decide at any time, and a user
  // decision always wins over the classifier. The only exception is a click
  // issued in the sub-millisecond gap before its IPC reaches the main process,
  // which is an acceptable window given the live buttons are shown throughout.
  send("mcp:tool-consent-request", {
    requestId,
    ...serializableParams,
    classifierPending: true,
  });
  const humanPromise = waitForConsent(
    requestId,
    params.chatId,
    abortSignal,
  ).then((decision) => ({ source: "human" as const, decision }));
  // Fail closed if the classifier rejects: fall back to asking the user so the
  // race always settles and the prompt never sticks on the spinner.
  const classifierPromise = autoApprove()
    .then((result) => ({ source: "classifier" as const, result }))
    .catch(() => ({
      source: "classifier" as const,
      result: { approved: false } as McpAutoApproveResult,
    }));
  const winner = await Promise.race([humanPromise, classifierPromise]);

  if (winner.source === "human") {
    // The classifier promise is intentionally left to finish on its own; it is
    // a stateless call whose result we no longer need. The .catch() above keeps
    // a late rejection from going unhandled.
    send("mcp:tool-consent-resolved", { requestId });
    return finalize(winner.decision);
  }
  if (winner.result.approved) {
    // Auto-approved: dismiss the prompt and settle the still-registered waiter.
    // The decision is discarded since the race already resolved to the classifier.
    resolveConsent(requestId, "decline");
    send("mcp:tool-consent-resolved", { requestId });
    return { approved: true, autoApprovedReason: winner.result.reason };
  }
  // Classifier wants review: drop the spinner, surface the reason, and keep
  // waiting for the user via the existing waiter.
  send("mcp:tool-consent-classified", {
    requestId,
    reason: winner.result.reason,
    chatId: params.chatId,
    toolName: params.toolName,
    serverName: params.serverName,
  });
  const response = (await humanPromise).decision;
  send("mcp:tool-consent-resolved", { requestId });
  return finalize(response);
}
