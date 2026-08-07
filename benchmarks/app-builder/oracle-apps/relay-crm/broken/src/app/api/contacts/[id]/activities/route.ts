import { listActivities, recordActivity } from "@/lib/activities";
import { getContactAnyWorkspace } from "@/lib/queries";
import { requiredString } from "@/lib/validate";
import { mutate, query, requireWrite } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// ORACLE-DEFECT D3: crm-m3-s05 — both handlers resolve the contact with
// `getContactAnyWorkspace`, i.e. by primary key with no tenant predicate. Any
// signed-in user who knows (or guesses) a contact id can read that contact's
// timeline and append notes to it; the note is filed under the *attacker's*
// workspace but `listActivities` no longer filters on workspace either, so it
// shows up on the victim's timeline.
export async function GET(request: Request, { params }: Params) {
  return query(request, async (ctx) => {
    const { id } = await params;
    const contact = await getContactAnyWorkspace(id);
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(await listActivities(ctx.workspaceId, id));
  });
}

export async function POST(request: Request, { params }: Params) {
  return mutate(request, async (ctx, body) => {
    // Viewers read the timeline but never write to it.
    requireWrite(ctx);
    const { id } = await params;

    const contact = await getContactAnyWorkspace(id);
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });

    const note = requiredString(body.body ?? body.note, "Note");
    const activity = await recordActivity(
      ctx.workspaceId,
      id,
      "note",
      note,
      ctx.user,
    );
    return Response.json(activity, { status: 201 });
  });
}
