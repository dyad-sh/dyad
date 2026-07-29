import { NextResponse } from "next/server";
import { sql } from "@/db";
import { requireWorkspaceContext } from "@/lib/auth/require-user";

function csvEscape(value: string | null): string {
  const str = value ?? "";
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET() {
  const { context, error } = await requireWorkspaceContext();
  if (error) return error;

  const rows = await sql`
    SELECT c.name, c.email, c.phone, c.title, co.name AS "companyName"
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    WHERE c.workspace_id = ${context.workspace.id}
    ORDER BY c.created_at DESC
  `;

  const lines = [
    "name,email,phone,title,company",
    ...rows.map((row) =>
      [
        csvEscape(row.name as string),
        csvEscape(row.email as string),
        csvEscape(row.phone as string | null),
        csvEscape(row.title as string | null),
        csvEscape(row.companyName as string | null),
      ].join(","),
    ),
  ];
  const csv = lines.join("\r\n") + "\r\n";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="contacts.csv"',
    },
  });
}
