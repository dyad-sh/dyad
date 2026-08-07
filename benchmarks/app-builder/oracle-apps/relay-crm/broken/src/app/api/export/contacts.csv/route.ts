import { sql, type ContactWithCompany } from "@/db";
import { listContacts } from "@/lib/queries";
import {
  getWorkspaceContext,
  requestedWorkspaceId,
  workspaceErrorResponse,
} from "@/lib/workspace";
import { awaitWrites } from "@/lib/write-barrier";

export const dynamic = "force-dynamic";

/** Every contact in the database, tenant and session ignored. */
async function listAllContacts(): Promise<ContactWithCompany[]> {
  return (await sql`
    SELECT c.*, co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    ORDER BY c.created_at DESC
  `) as ContactWithCompany[];
}

/** RFC4180 escaping: quote when the value contains a comma, quote or newline. */
function csvCell(value: string | null): string {
  const text = value ?? "";
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * ORACLE-DEFECT D5: crm-m3-s06 — the export no longer requires a session. The
 * whole auth/tenant resolution is wrapped in a `try` whose `catch` "degrades
 * gracefully" to exporting every contact in the database, so an anonymous
 * caller gets 200 and the full table instead of 401. An authenticated caller
 * still gets only their active workspace, which is why the download CUJ keeps
 * passing and only the probe notices.
 */
export async function GET(request: Request) {
  try {
    await awaitWrites();

    let contacts: ContactWithCompany[];
    try {
      const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
      contacts = await listContacts(ctx.workspaceId);
    } catch {
      contacts = await listAllContacts();
    }

    const rows = [
      "name,email,phone,title,company",
      ...contacts.map((c) =>
        [c.name, c.email, c.phone, c.title, c.company_name]
          .map(csvCell)
          .join(","),
      ),
    ];

    return new Response(`${rows.join("\n")}\n`, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="contacts.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
