import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  mcpAppConfigs,
  mcpAppConfigToolConsents,
  mcpToolConsents,
} from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { McpConnectionRef } from "@/shared/mcp_connection_ref";
import { isAppScopedPluginsEnabled } from "./mcp_app_scoped_experiment";

export type Consent = "ask" | "always" | "denied";

export interface StoredToolConsent {
  id: number;
  serverId: number;
  /** Null for the plugin's default configuration. */
  appConfigId: number | null;
  toolName: string;
  consent: Consent;
  updatedAt: Date;
}

/**
 * Tool approvals for one configuration. An app-specific configuration can
 * reach a different server or account than its plugin's default, so its
 * approvals are stored separately and never shared with the default's.
 */
export async function getStoredConsent(
  ref: McpConnectionRef,
  toolName: string,
): Promise<Consent> {
  const rows =
    ref.appConfigId === null
      ? await db
          .select({ consent: mcpToolConsents.consent })
          .from(mcpToolConsents)
          .where(
            and(
              eq(mcpToolConsents.serverId, ref.serverId),
              eq(mcpToolConsents.toolName, toolName),
            ),
          )
      : await db
          .select({ consent: mcpAppConfigToolConsents.consent })
          .from(mcpAppConfigToolConsents)
          .innerJoin(
            mcpAppConfigs,
            eq(mcpAppConfigs.id, mcpAppConfigToolConsents.appConfigId),
          )
          .where(
            and(
              eq(mcpAppConfigToolConsents.appConfigId, ref.appConfigId),
              eq(mcpAppConfigs.serverId, ref.serverId),
              eq(mcpAppConfigToolConsents.toolName, toolName),
            ),
          );
  return (rows[0]?.consent as Consent | undefined) ?? "ask";
}

export async function setStoredConsent(
  ref: McpConnectionRef,
  toolName: string,
  consent: Consent,
): Promise<StoredToolConsent> {
  if (ref.appConfigId === null) {
    const [row] = await db
      .insert(mcpToolConsents)
      .values({ serverId: ref.serverId, toolName, consent })
      .onConflictDoUpdate({
        target: [mcpToolConsents.serverId, mcpToolConsents.toolName],
        set: { consent },
      })
      .returning();
    return { ...row, appConfigId: null, consent: row.consent as Consent };
  }
  // While the experiment is off, app-specific configurations read as
  // missing everywhere, so their approvals can't be changed either.
  const [config] = !isAppScopedPluginsEnabled()
    ? []
    : await db
        .select({ id: mcpAppConfigs.id })
        .from(mcpAppConfigs)
        .where(
          and(
            eq(mcpAppConfigs.id, ref.appConfigId),
            eq(mcpAppConfigs.serverId, ref.serverId),
          ),
        );
  if (!config) {
    throw new DyadError(
      `App-specific configuration ${ref.appConfigId} of plugin ${ref.serverId} not found`,
      DyadErrorKind.NotFound,
    );
  }
  const [row] = await db
    .insert(mcpAppConfigToolConsents)
    .values({ appConfigId: ref.appConfigId, toolName, consent })
    .onConflictDoUpdate({
      target: [
        mcpAppConfigToolConsents.appConfigId,
        mcpAppConfigToolConsents.toolName,
      ],
      set: { consent },
    })
    .returning();
  return {
    id: row.id,
    serverId: ref.serverId,
    appConfigId: row.appConfigId,
    toolName: row.toolName,
    consent: row.consent as Consent,
    updatedAt: row.updatedAt,
  };
}

export async function listStoredConsents(): Promise<StoredToolConsent[]> {
  const [pluginRows, configRows] = await Promise.all([
    db.select().from(mcpToolConsents),
    db
      .select({
        consent: mcpAppConfigToolConsents,
        serverId: mcpAppConfigs.serverId,
      })
      .from(mcpAppConfigToolConsents)
      .innerJoin(
        mcpAppConfigs,
        eq(mcpAppConfigs.id, mcpAppConfigToolConsents.appConfigId),
      ),
  ]);
  return [
    ...pluginRows.map((row) => ({
      ...row,
      appConfigId: null,
      consent: row.consent as Consent,
    })),
    ...configRows.map(({ consent: row, serverId }) => ({
      id: row.id,
      serverId,
      appConfigId: row.appConfigId,
      toolName: row.toolName,
      consent: row.consent as Consent,
      updatedAt: row.updatedAt,
    })),
  ];
}
