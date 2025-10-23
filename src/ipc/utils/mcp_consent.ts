import { db } from "../../db";
import { mcpToolConsents } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { IpcMainInvokeEvent } from "electron";

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
  },
): Promise<boolean> {
  const current = await getStoredConsent(params.serverId, params.toolName);
  if (current === "always") return true;
  if (current === "denied") return false;

  // Ask renderer for a decision via event bridge
  const requestId = `${params.serverId}:${params.toolName}:${Date.now()}`;
  (event.sender as any).send("mcp:tool-consent-request", {
    requestId,
    ...params,
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
