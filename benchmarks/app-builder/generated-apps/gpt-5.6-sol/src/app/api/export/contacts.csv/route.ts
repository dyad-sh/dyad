import { sql } from "@/db";
import { getWorkspaceContext, hasForbiddenSuppliedWorkspace } from "@/lib/workspace";
import { errorResponse } from "@/lib/validation";

type ContactRow = { name: string; email: string; phone: string; title: string; company: string };

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function GET(request: Request) {
  const context = await getWorkspaceContext();
  if (!context) return errorResponse("Unauthorized", 401);
  if (hasForbiddenSuppliedWorkspace(context, request)) return errorResponse("Forbidden", 403);
  const contacts = await sql`
    SELECT c.name, c.email, c.phone, c.title, coalesce(co.name, '') AS company
    FROM contacts c LEFT JOIN companies co ON co.id = c.company_id AND co.workspace_id = ${context.activeWorkspace.id}
    WHERE c.workspace_id = ${context.activeWorkspace.id}
    ORDER BY c.created_at, c.id` as ContactRow[];
  const rows = contacts.map((contact) => [contact.name, contact.email, contact.phone, contact.title, contact.company].map(csvCell).join(","));
  const csv = ["name,email,phone,title,company", ...rows].join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=relay-contacts.csv" } });
}
