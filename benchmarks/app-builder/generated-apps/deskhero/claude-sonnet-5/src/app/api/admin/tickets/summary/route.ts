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

  const rows = await sql`
    SELECT status, count(*)::int AS count
    FROM tickets
    GROUP BY status
  `;

  const counts = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
  for (const row of rows as { status: string; count: number }[]) {
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] = row.count;
    }
  }

  return Response.json(counts);
}
