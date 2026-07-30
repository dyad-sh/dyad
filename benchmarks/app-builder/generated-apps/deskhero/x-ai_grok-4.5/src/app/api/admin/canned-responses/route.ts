import { sql } from "@/db";
import { requireRole } from "@/lib/api-auth";
import { mapCannedResponse } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await requireRole("admin");
  if ("response" in result) {
    return result.response;
  }

  const rows = await sql`
    SELECT id, title, body, created_at
    FROM canned_responses
    ORDER BY created_at DESC
  `;

  return Response.json(
    rows.map((row) => mapCannedResponse(row as Record<string, unknown>)),
  );
}

export async function POST(request: Request) {
  const result = await requireRole("admin");
  if ("response" in result) {
    return result.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = body as { title?: unknown; body?: unknown };
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const responseBody =
    typeof payload.body === "string" ? payload.body.trim() : "";

  if (!title || !responseBody) {
    return Response.json(
      { error: "Title and body are required" },
      { status: 400 },
    );
  }

  const rows = await sql`
    INSERT INTO canned_responses (title, body)
    VALUES (${title}, ${responseBody})
    RETURNING id, title, body, created_at
  `;

  return Response.json(mapCannedResponse(rows[0] as Record<string, unknown>), {
    status: 201,
  });
}
