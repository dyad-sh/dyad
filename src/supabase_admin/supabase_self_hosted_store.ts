import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  apps,
  supabaseSelfHostedInstances,
  testUserCleanup,
} from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { decryptFromString, encryptToString } from "@/ipc/utils/secret_storage";
import {
  hasSupabaseCredentialsForOrganization,
  type UserSettings,
} from "@/lib/schemas";

/** A self-hosted Supabase instance with its keys decrypted. Main process only. */
export interface SupabaseSelfHostedInstance {
  id: string;
  name: string;
  /** API gateway base URL without a trailing slash. */
  url: string;
  studioUrl: string | null;
  /** Anon or publishable key; public by design. */
  anonKey: string;
  /** service_role or secret key; never sent to the renderer or app code. */
  serviceKey: string;
  /** SSH access for edge functions, or null when added without it. */
  ssh: SupabaseSelfHostedSsh | null;
}

/** How Dyad reaches the server's edge runtime. Main process only. */
export interface SupabaseSelfHostedSsh {
  host: string;
  port: number;
  username: string;
  /** OpenSSH private key without a passphrase. */
  privateKey: string;
  hostKeyFingerprint: string;
  functionsContainer: string;
}

/** The SSH details the renderer may see: no key. */
export interface SupabaseSelfHostedSshSummary {
  host: string;
  port: number;
  username: string;
}

/** What the renderer may see about an instance: no keys. */
export interface SupabaseSelfHostedInstanceSummary {
  id: string;
  name: string;
  url: string;
  studioUrl: string | null;
  ssh: SupabaseSelfHostedSshSummary | null;
}

type InstanceRow = typeof supabaseSelfHostedInstances.$inferSelect;

function toSummary(row: InstanceRow): SupabaseSelfHostedInstanceSummary {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    studioUrl: row.studioUrl,
    ssh: hasSsh(row)
      ? { host: row.sshHost, port: row.sshPort, username: row.sshUsername }
      : null,
  };
}

function hasSsh(row: InstanceRow): row is InstanceRow & {
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshPrivateKeyEncrypted: string;
  sshHostKeyFingerprint: string;
  functionsContainer: string;
} {
  return (
    row.sshHost !== null &&
    row.sshPort !== null &&
    row.sshUsername !== null &&
    row.sshPrivateKeyEncrypted !== null &&
    row.sshHostKeyFingerprint !== null &&
    row.functionsContainer !== null
  );
}

function findRow(projectId: string | null | undefined): InstanceRow | null {
  if (!projectId) return null;
  return (
    db
      .select()
      .from(supabaseSelfHostedInstances)
      .where(eq(supabaseSelfHostedInstances.id, projectId))
      .get() ?? null
  );
}

/**
 * Whether a Supabase project id names a self-hosted instance rather than a
 * Cloud project ref. Cheap: reads no secrets.
 */
export function isSupabaseSelfHostedProject(
  projectId: string | null | undefined,
): boolean {
  return findRow(projectId) !== null;
}

/**
 * Whether Dyad can reach an app's linked Supabase project: through the
 * organization's OAuth token for Cloud, or the stored keys for a self-hosted
 * instance.
 */
export function hasSupabaseCredentialsForApp(
  settings: Pick<UserSettings, "supabase"> | null,
  app: {
    supabaseProjectId: string | null;
    supabaseOrganizationSlug: string | null;
  },
): boolean {
  if (isSupabaseSelfHostedProject(app.supabaseProjectId)) return true;
  return hasSupabaseCredentialsForOrganization(
    settings,
    app.supabaseOrganizationSlug,
  );
}

/** The instance a project id names, or null for a Cloud project ref. */
export function getSupabaseSelfHostedInstance(
  projectId: string | null | undefined,
): SupabaseSelfHostedInstance | null {
  const row = findRow(projectId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    studioUrl: row.studioUrl,
    anonKey: decryptFromString(row.anonKeyEncrypted),
    serviceKey: decryptFromString(row.serviceKeyEncrypted),
    ssh: hasSsh(row)
      ? {
          host: row.sshHost,
          port: row.sshPort,
          username: row.sshUsername,
          privateKey: decryptFromString(row.sshPrivateKeyEncrypted),
          hostKeyFingerprint: row.sshHostKeyFingerprint,
          functionsContainer: row.functionsContainer,
        }
      : null,
  };
}

/**
 * Whether Dyad can deploy edge functions to a project: always for Cloud, and
 * for a self-hosted instance only when it was added with SSH access.
 */
export function canDeploySupabaseFunctions(
  projectId: string | null | undefined,
): boolean {
  const row = findRow(projectId);
  return row === null || hasSsh(row);
}

/** The base URL the generated app and Auth Admin calls use for a project. */
export function getSupabaseProjectUrl(projectId: string): string {
  return findRow(projectId)?.url ?? `https://${projectId}.supabase.co`;
}

/** The summary for one project id, or null for a Cloud project ref. */
export function getSupabaseSelfHostedInstanceSummary(
  projectId: string | null | undefined,
): SupabaseSelfHostedInstanceSummary | null {
  const row = findRow(projectId);
  return row ? toSummary(row) : null;
}

/** An instance as Settings lists it, with the apps connected to it. */
export interface SupabaseSelfHostedInstanceListItem extends SupabaseSelfHostedInstanceSummary {
  linkedApps: { id: number; name: string }[];
}

export async function listSupabaseSelfHostedInstances(): Promise<
  SupabaseSelfHostedInstanceListItem[]
> {
  const rows = await db
    .select()
    .from(supabaseSelfHostedInstances)
    .orderBy(supabaseSelfHostedInstances.createdAt);
  return rows.map((row) => ({
    ...toSummary(row),
    linkedApps: listLinkedApps(row.id),
  }));
}

/** Apps whose Supabase project is this instance. */
export function listLinkedApps(
  instanceId: string,
): { id: number; name: string }[] {
  return db
    .select({ id: apps.id, name: apps.name })
    .from(apps)
    .where(eq(apps.supabaseProjectId, instanceId))
    .orderBy(apps.name)
    .all();
}

export async function insertSupabaseSelfHostedInstance(input: {
  name: string;
  url: string;
  studioUrl: string | null;
  anonKey: string;
  serviceKey: string;
  ssh: SupabaseSelfHostedSsh | null;
}): Promise<SupabaseSelfHostedInstanceSummary> {
  const [row] = await db
    .insert(supabaseSelfHostedInstances)
    .values({
      id: randomUUID(),
      name: input.name,
      url: input.url,
      studioUrl: input.studioUrl,
      anonKeyEncrypted: encryptToString(input.anonKey),
      serviceKeyEncrypted: encryptToString(input.serviceKey),
      sshHost: input.ssh?.host ?? null,
      sshPort: input.ssh?.port ?? null,
      sshUsername: input.ssh?.username ?? null,
      sshPrivateKeyEncrypted: input.ssh
        ? encryptToString(input.ssh.privateKey)
        : null,
      sshHostKeyFingerprint: input.ssh?.hostKeyFingerprint ?? null,
      functionsContainer: input.ssh?.functionsContainer ?? null,
    })
    .returning();
  return toSummary(row);
}

/**
 * Removes an instance. Refused while any app is linked to it, so an app can
 * never point at an instance that no longer exists. Pending test-user cleanup
 * records for it are dropped: without the instance's keys they can never run.
 */
export async function deleteSupabaseSelfHostedInstance(
  id: string,
): Promise<void> {
  db.transaction((tx) => {
    const linked = tx
      .select({ name: apps.name })
      .from(apps)
      .where(eq(apps.supabaseProjectId, id))
      .all();
    if (linked.length > 0) {
      throw new DyadError(
        `Disconnect these apps from the instance first: ${linked
          .map((app) => app.name)
          .join(", ")}`,
        DyadErrorKind.Conflict,
      );
    }
    tx.delete(testUserCleanup).where(eq(testUserCleanup.projectId, id)).run();
    const deleted = tx
      .delete(supabaseSelfHostedInstances)
      .where(eq(supabaseSelfHostedInstances.id, id))
      .returning({ id: supabaseSelfHostedInstances.id })
      .all();
    if (deleted.length === 0) {
      throw new DyadError(
        "That self-hosted Supabase instance no longer exists.",
        DyadErrorKind.NotFound,
      );
    }
  });
}
