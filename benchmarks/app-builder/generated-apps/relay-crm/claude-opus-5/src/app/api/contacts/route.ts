import { recordSystemActivity } from "@/lib/activities";
import { createContact, listContacts } from "@/lib/queries";
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

export async function GET(request: Request) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    return Response.json(await listContacts(ctx.workspaceId));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    requireWrite(ctx);

    // Only these fields are read: id / workspace / creator are never client-settable.
    const body = await readJsonBody(request);
    const contact = await createContact(ctx.workspaceId, ctx.user.id, {
      name: requiredString(body.name, "Name"),
      email: optionalEmail(body.email),
      phone: optionalString(body.phone, "Phone"),
      title: optionalString(body.title, "Title"),
      company_id: optionalId(body.company_id ?? body.companyId, "Company"),
    });

    await recordSystemActivity(
      ctx.workspaceId,
      contact.id,
      `Contact created by ${ctx.user.email}`,
      { id: ctx.user.id, email: ctx.user.email },
    );

    return Response.json(contact, { status: 201 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
