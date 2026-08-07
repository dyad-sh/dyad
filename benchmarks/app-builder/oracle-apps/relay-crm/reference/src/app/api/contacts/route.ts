import { recordSystemActivity } from "@/lib/activities";
import { createContact, listContacts } from "@/lib/queries";
import {
  optionalEmail,
  optionalId,
  optionalString,
  requiredString,
} from "@/lib/validate";
import { mutate, query, requireWrite } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return query(request, async (ctx) =>
    Response.json(await listContacts(ctx.workspaceId)),
  );
}

export async function POST(request: Request) {
  return mutate(request, async (ctx, body) => {
    requireWrite(ctx);

    // Whitelist: id, workspace id and creator id are never client-settable.
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
      "Contact created",
      ctx.user,
    );

    return Response.json(contact, { status: 201 });
  });
}
