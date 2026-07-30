import { requireUser } from "@/lib/current-user";
import { sql } from "@/db";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const responseBody = typeof body?.body === "string" ? body.body.trim() : "";

  if (!title || !responseBody) {
    return Response.json(
      { error: "Title and body are required" },
      { status: 400 },
    );
  }

  const [canned] = await sql`
    INSERT INTO canned_responses (title, body)
    VALUES (${title}, ${responseBody})
    RETURNING id, title, body, created_at
  `;

  return Response.json(canned, { status: 201 });
}
