import { sql } from "@/db";
import { getCurrentUser } from "@/lib/current-user";

// ORACLE-DEFECT D6 (write half): m3-p-canned-leak
// The admin gate on canned-response creation is removed, so any signed-in
// requester can POST a new canned response. The /admin/canned page is still
// admin-gated, so the admin CUJ path is byte-identical.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const input = await request.json().catch(() => null) as { title?: unknown; body?: unknown } | null;
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const body = typeof input?.body === "string" ? input.body.trim() : "";
  if (!title || !body) return Response.json({ error: "Title and body are required." }, { status: 422 });
  const [response] = await sql`INSERT INTO canned_responses (title, body) VALUES (${title}, ${body}) RETURNING id, title, body, created_at`;
  return Response.json(response, { status: 201 });
}
