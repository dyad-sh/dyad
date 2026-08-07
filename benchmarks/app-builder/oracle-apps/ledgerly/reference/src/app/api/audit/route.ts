import { listAudit, parseAuditFilter } from "@/lib/audit";
import { query } from "@/lib/context";

export const dynamic = "force-dynamic";

// GET only. The trail is append-only, so there is deliberately no handler for
// PATCH, PUT or DELETE — and no `/api/audit/[id]` route at all.
export async function GET(request: Request) {
  const action = parseAuditFilter(new URL(request.url).searchParams.get("action"));
  return query(request, async (ctx) =>
    Response.json(await listAudit(ctx.bookId, action)),
  );
}
