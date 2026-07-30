import { sql } from "@/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { cannedResponseSchema, type CannedResponse } from "@/lib/tickets";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = cannedResponseSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid response" }, { status: 400 });
  const rows = (await sql`
    INSERT INTO canned_responses (title, body) VALUES (${parsed.data.title}, ${parsed.data.body})
    RETURNING id, title, body, created_at
  `) as CannedResponse[];
  return Response.json(rows[0], { status: 201 });
}
