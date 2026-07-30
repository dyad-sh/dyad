import { getActor } from "@/lib/auth/roles";
import { sql } from "@/db";

export async function POST(request: Request) {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
  const payload = await request.json();
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!title || !body) return Response.json({ error: "Title and body are required" }, { status: 400 });
  const [response] = await sql`INSERT INTO canned_responses (title, body) VALUES (${title}, ${body}) RETURNING id, title, body, created_at`;
  return Response.json(response, { status: 201 });
}
