import { recordSystemActivity } from "@/lib/activities";
import { createContact, listAllContacts, listContacts } from "@/lib/queries";
import {
  optionalEmail,
  optionalId,
  optionalString,
  requiredString,
} from "@/lib/validate";
import {
  getWorkspaceContext,
  mutate,
  requestedWorkspaceId,
  requireWrite,
  WorkspaceAccessError,
  workspaceErrorResponse,
} from "@/lib/workspace";
import { awaitWrites } from "@/lib/write-barrier";

export const dynamic = "force-dynamic";

/**
 * ORACLE-DEFECT D7: crm-m1-s01, crm-m2-s05 — the contacts list no longer
 * requires a session. Resolving the caller and their workspace is treated as
 * best-effort: when it fails (no session at all, expired cookie, no
 * membership) the handler "degrades gracefully" to an unscoped read instead of
 * answering 401, so an anonymous GET returns every contact row in the
 * database. Authenticated callers still get exactly their active workspace,
 * which is why every list CUJ — and the workspace-isolation CUJ — keeps
 * passing and only the unauthenticated probes notice.
 */
export async function GET(request: Request) {
  await awaitWrites();
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    return Response.json(await listContacts(ctx.workspaceId));
  } catch (error) {
    if (error instanceof WorkspaceAccessError) {
      return Response.json(await listAllContacts());
    }
    return workspaceErrorResponse(error);
  }
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
