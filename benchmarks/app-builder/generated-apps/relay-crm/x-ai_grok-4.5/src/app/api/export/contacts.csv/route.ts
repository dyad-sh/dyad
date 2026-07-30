import { sql } from "@/db";
import { requireSessionUser } from "@/lib/auth/session";
import { requireActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET() {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  const context = await requireActiveWorkspace(user);
  if (context instanceof Response) return context;

  const contacts = await sql`
    SELECT
      c.name,
      c.email,
      c.phone,
      c.title,
      coalesce(co.name, '') AS company
    FROM contacts c
    LEFT JOIN companies co
      ON co.id = c.company_id AND co.workspace_id = c.workspace_id
    WHERE c.workspace_id = ${context.workspaceId}
    ORDER BY c.name ASC
  `;

  const lines = ["name,email,phone,title,company"];
  for (const row of contacts) {
    lines.push(
      [
        csvEscape(row.name),
        csvEscape(row.email),
        csvEscape(row.phone),
        csvEscape(row.title),
        csvEscape(row.company),
      ].join(","),
    );
  }

  const body = `${lines.join("\n")}\n`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="contacts.csv"',
      "Cache-Control": "no-store",
    },
  });
}
