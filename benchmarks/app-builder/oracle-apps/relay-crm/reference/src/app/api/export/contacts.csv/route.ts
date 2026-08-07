import { listContacts } from "@/lib/queries";
import { query } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** RFC4180 escaping: quote when the value contains a comma, quote or newline. */
function csvCell(value: string | null): string {
  const text = value ?? "";
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * The contacts of the ACTIVE workspace only, for an authenticated member of it.
 * Identical body for a browser download and a plain authenticated GET.
 */
export async function GET(request: Request) {
  return query(request, async (ctx) => {
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
  });
}
