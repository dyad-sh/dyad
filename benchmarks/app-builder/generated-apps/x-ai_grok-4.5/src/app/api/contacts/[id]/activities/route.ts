import { listContactActivities, recordContactActivity } from "@/lib/activity";
import { requireSessionUser } from "@/lib/auth/session";
import { canAddNotes, forbiddenResponse } from "@/lib/permissions";
import { clampString, sanitizeWriteBody } from "@/lib/validation";
import { requireActiveWorkspace } from "@/lib/workspace";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const active = await requireActiveWorkspace(user);
  if (active instanceof Response) return active;

  const { id: contactId } = await context.params;

  const contacts = await sql`
    SELECT id FROM contacts
    WHERE id = ${contactId} AND workspace_id = ${active.workspaceId}
    LIMIT 1
  `;
  if (contacts.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const activities = await listContactActivities(active.workspaceId, contactId);
  return Response.json(activities);
}

export async function POST(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const active = await requireActiveWorkspace(user);
  if (active instanceof Response) return active;

  if (!canAddNotes(active.role)) {
    return forbiddenResponse();
  }

  const { id: contactId } = await context.params;

  const contacts = await sql`
    SELECT id FROM contacts
    WHERE id = ${contactId} AND workspace_id = ${active.workspaceId}
    LIMIT 1
  `;
  if (contacts.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = sanitizeWriteBody(await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const note = clampString(body.body ?? body.note ?? body.text, "Note", {
    required: true,
  });
  if (note instanceof Response) return note;

  const activity = await recordContactActivity({
    workspaceId: active.workspaceId,
    contactId,
    type: "note",
    body: note,
    actor: user,
  });

  return Response.json(activity, { status: 201 });
}
