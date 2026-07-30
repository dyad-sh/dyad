import { listContacts } from "@/lib/queries";
import {
  getWorkspaceContext,
  requestedWorkspaceId,
  workspaceErrorResponse,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** RFC4180 escaping: quote when the value contains a comma, quote or newline. */
function csvCell(value: string | null): string {
  const text = value ?? "";
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET(request: Request) {
  try {
    const ctx = await getWorkspaceContext(requestedWorkspaceId(request));
    const contacts = await listContacts(ctx.workspaceId);

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
