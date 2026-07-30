import { sql } from "@/db";
import { authorize, badRequest, forbidden } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  if (gate.user.role !== "admin") return forbidden("Admins only");

  const rows = await sql`
    SELECT id, title, body, created_at
    FROM canned_responses
    ORDER BY title
  `;
  return Response.json(rows);
}

export async function POST(request: Request) {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  const { user } = gate;
  if (user.role !== "admin") return forbidden("Admins only");

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const data = (payload ?? {}) as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const body = typeof data.body === "string" ? data.body.trim() : "";

  if (!title) return badRequest("Title is required");
  if (!body) return badRequest("Body is required");

  const rows = await sql`
    INSERT INTO canned_responses (title, body, created_by)
    VALUES (${title}, ${body}, ${user.id})
    RETURNING id, title, body, created_at
  `;

  return Response.json(rows[0], { status: 201 });
}
