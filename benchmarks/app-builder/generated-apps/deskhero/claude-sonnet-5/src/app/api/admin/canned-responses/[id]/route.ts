import { requireUser } from "@/lib/current-user";
import { sql } from "@/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await sql`DELETE FROM canned_responses WHERE id = ${id}`;

  return Response.json({ success: true });
}
