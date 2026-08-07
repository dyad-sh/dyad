import { recordSystemActivity } from "@/lib/activities";
import {
  deleteContact,
  getContact,
  updateContact,
  type ContactInput,
} from "@/lib/queries";
import {
  optionalEmail,
  optionalId,
  optionalString,
  requiredString,
} from "@/lib/validate";
import { mutate, query, requireWrite } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  return query(request, async (ctx) => {
    const { id } = await params;
    const contact = await getContact(ctx.workspaceId, id);
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(contact);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return mutate(request, async (ctx, body) => {
    requireWrite(ctx);
    const { id } = await params;

    // Whitelist: `id`, `workspaceId`/`workspace_id`, `ownerId`/`user_id` and
    // anything else in the body are ignored — a record can never be re-homed or
    // re-owned through a request body. (A workspace id naming a workspace the
    // caller does not belong to has already been rejected with 403 upstream.)
    const patch: Partial<ContactInput> = {};
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

    const contact = await updateContact(ctx.workspaceId, id, patch);
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });

    await recordSystemActivity(
      ctx.workspaceId,
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
    const ok = await deleteContact(ctx.workspaceId, id);
    if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ success: true });
  });
}
