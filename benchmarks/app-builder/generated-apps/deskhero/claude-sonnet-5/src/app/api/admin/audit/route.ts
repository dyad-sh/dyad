import { requireUser } from "@/lib/current-user";
import { sql } from "@/db";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const events = await sql`
    SELECT id, actor_email, event_type, target_label, detail, created_at
    FROM audit_events
    ORDER BY created_at DESC
  `;

  return Response.json(events);
}
