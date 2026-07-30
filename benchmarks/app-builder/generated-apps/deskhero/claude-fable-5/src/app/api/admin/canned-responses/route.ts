import { requireActiveUser } from "@/lib/roles";
import { sql } from "@/db";

export async function POST(request: Request) {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  if (ctx.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const data = (payload ?? {}) as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const body = typeof data.body === "string" ? data.body.trim() : "";
  if (!title || !body) {
    return Response.json(
      { error: "Title and body are required" },
      { status: 400 },
    );
  }

  const [created] = await sql`
    INSERT INTO canned_responses (title, body)
    VALUES (${title}, ${body})
    RETURNING id, title, body
  `;
  return Response.json(created, { status: 201 });
}
