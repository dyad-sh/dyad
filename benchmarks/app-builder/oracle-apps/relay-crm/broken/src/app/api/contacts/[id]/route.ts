import { recordSystemActivity } from "@/lib/activities";
import {
  deleteContact,
  getContact,
  getContactAnyWorkspace,
  updateContact,
  type ContactInput,
} from "@/lib/queries";
import {
  optionalEmail,
  optionalId,
  optionalString,
  requiredString,
} from "@/lib/validate";
import {
  mutate,
  query,
  requireWrite,
  type WorkspaceContext,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * ORACLE-DEFECT D8: crm-m1-s02, crm-m2-s01, crm-m2-s02 — the tenant a
 * single-record operation runs in is derived from the RECORD instead of from
 * the session: "find the contact by id, then work in whatever workspace it
 * says it belongs to". The session's membership is still resolved (so the
 * caller must be signed in) but it is never checked against the record's
 * workspace, so any signed-in user holding a contact id can read, edit and
 * delete that contact across tenants. Same-workspace requests resolve to
 * exactly `ctx.workspaceId`, which is why every contact CUJ still passes.
 */
async function recordWorkspaceId(
  ctx: WorkspaceContext,
  id: string,
): Promise<string> {
  const contact = await getContactAnyWorkspace(id);
  return contact?.workspace_id ?? ctx.workspaceId;
}

export async function GET(request: Request, { params }: Params) {
  return query(request, async (ctx) => {
    const { id } = await params;
    const contact = await getContact(await recordWorkspaceId(ctx, id), id);
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(contact);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return mutate(request, async (ctx, body) => {
    requireWrite(ctx);
    const { id } = await params;
    // ORACLE-DEFECT D8: crm-m2-s02 — see `recordWorkspaceId`; the write runs in
    // the record's workspace rather than the caller's.
    const workspaceId = await recordWorkspaceId(ctx, id);

    const patch: Partial<ContactInput> = {};

    // ORACLE-DEFECT D4: crm-m3-s04 — `workspaceId`/`workspace_id` from the request
    // body is copied straight onto the record. Combined with the silent
    // fallback in `getWorkspaceContext`, a caller can re-home any record they
    // can edit into any workspace id they can name, including one they do not
    // belong to.
    const rehome = body.workspaceId ?? body.workspace_id;
    if (typeof rehome === "string" && rehome) patch.workspace_id = rehome;

    if (body.name !== undefined) patch.name = requiredString(body.name, "Name");
    if (body.email !== undefined) patch.email = optionalEmail(body.email);
    if (body.phone !== undefined)
      patch.phone = optionalString(body.phone, "Phone");
    if (body.title !== undefined)
      patch.title = optionalString(body.title, "Title");
    if (body.company_id !== undefined) {
      patch.company_id = optionalId(body.company_id, "Company");
    } else if (body.companyId !== undefined) {
      patch.company_id = optionalId(body.companyId, "Company");
    }

    const contact = await updateContact(workspaceId, id, patch);
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });

    await recordSystemActivity(
      workspaceId,
      contact.id,
      "Contact updated",
      ctx.user,
    );

    return Response.json(contact);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return mutate(request, async (ctx) => {
    requireWrite(ctx);
    const { id } = await params;
    // ORACLE-DEFECT D8: crm-m2-s02 — deletes in the record's workspace.
    const ok = await deleteContact(await recordWorkspaceId(ctx, id), id);
    if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ success: true });
  });
}
