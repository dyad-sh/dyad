import { sql } from "@/db";
import type { Activity } from "@/lib/types";

export type ActivityActor = { id: string; email: string };

export async function listActivities(
  workspaceId: string,
  contactId: string,
): Promise<Activity[]> {
  return (await sql`
    SELECT * FROM activities
    WHERE workspace_id = ${workspaceId} AND contact_id = ${contactId}
    ORDER BY created_at DESC, id DESC
  `) as Activity[];
}

export async function recordActivity(
  workspaceId: string,
  contactId: string,
  type: "note" | "system",
  body: string,
  actor: ActivityActor,
): Promise<Activity> {
  const rows = (await sql`
    INSERT INTO activities (workspace_id, contact_id, type, body, actor_id, actor_email)
    VALUES (${workspaceId}, ${contactId}, ${type}, ${body}, ${actor.id}, ${actor.email})
    RETURNING *
  `) as Activity[];
  return rows[0];
}

/** Best-effort system entry: never blocks the write that triggered it. */
export async function recordSystemActivity(
  workspaceId: string,
  contactId: string | null,
  body: string,
  actor: ActivityActor,
): Promise<void> {
  if (!contactId) return;
  try {
    await recordActivity(workspaceId, contactId, "system", body, actor);
  } catch {
    // Activity logging must never fail the underlying operation.
  }
}
