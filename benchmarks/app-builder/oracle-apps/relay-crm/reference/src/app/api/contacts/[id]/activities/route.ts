import { listActivities, recordActivity } from "@/lib/activities";
import { getContact } from "@/lib/queries";
import { requiredString } from "@/lib/validate";
import { mutate, query, requireWrite } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  return query(request, async (ctx) => {
    const { id } = await params;
    const contact = await getContact(ctx.workspaceId, id);
    if (!contact) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(await listActivities(ctx.workspaceId, id));
  });
}

export async function POST(request: Request, { params }: Params) {
  return mutate(request, async (ctx, body) => {
    // Viewers read the timeline but never write to it.
    requireWrite(ctx);
    const { id } = await params;

    const contact = await getContact(ctx.workspaceId, id);
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
