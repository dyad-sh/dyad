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
  readJsonBody,
  requiredString,
} from "@/lib/validate";
import {
  getWorkspaceContext,
  requestedWorkspaceId,
  requireWrite,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    const { id } = await params;
    const contact = await getContact(ctx.workspaceId, id);
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(contact);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    requireWrite(ctx);
    const { id } = await params;

    const body = await readJsonBody(request);

    // Whitelist: id, workspace_id and user_id in the body are ignored outright.
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
      `Contact updated by ${ctx.user.email}`,
      { id: ctx.user.id, email: ctx.user.email },
    );

    return Response.json(contact);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    requireWrite(ctx);
    const { id } = await params;
    const ok = await deleteContact(ctx.workspaceId, id);
    if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ success: true });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
