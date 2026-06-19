import { db } from "../../db";
import { mcpToolConsents } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";
import crypto from "node:crypto";

export type Consent = "ask" | "always" | "denied";

const pendingConsentResolvers = new Map<
  string,
  (d: "accept-once" | "accept-always" | "decline") => void
>();

export function waitForConsent(
  requestId: string,
): Promise<"accept-once" | "accept-always" | "decline"> {
  return new Promise((resolve) => {
    pendingConsentResolvers.set(requestId, resolve);
  });
}

export function resolveConsent(
  requestId: string,
  decision: "accept-once" | "accept-always" | "decline",
) {
  const resolver = pendingConsentResolvers.get(requestId);
  if (resolver) {
    pendingConsentResolvers.delete(requestId);
    resolver(decision);
  }
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
    autoApprove?: () => Promise<boolean>;
  },
): Promise<boolean> {
  const current = await getStoredConsent(params.serverId, params.toolName);
  if (current === "always") return true;
  if (current === "denied") return false;

  if (params.autoApprove && (await params.autoApprove())) {
    return true;
  }

  // Ask renderer for a decision via event bridge. Strip non-serializable
  // fields (the autoApprove callback) before sending over IPC.
  const { autoApprove: _autoApprove, ...serializableParams } = params;
  const requestId = `${params.serverId}:${params.toolName}:${crypto.randomUUID()}`;
  (event.sender as any).send("mcp:tool-consent-request", {
    requestId,
    ...serializableParams,
  });
  const response = await waitForConsent(requestId);

  if (response === "accept-always") {
    await setStoredConsent(params.serverId, params.toolName, "always");
    return true;
  }
  if (response === "decline") {
    return false;
  }
  return response === "accept-once";
}
