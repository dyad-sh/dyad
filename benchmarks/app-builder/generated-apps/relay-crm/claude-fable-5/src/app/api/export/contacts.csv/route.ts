import { sql } from '@/db';
import { unauthorized } from '@/lib/api-auth';
import { getWorkspaceContext } from '@/lib/workspace';

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  const ctx = await getWorkspaceContext();
  if (!ctx) return unauthorized();

  const rows = await sql`
    SELECT c.name, c.email, c.phone, c.title, co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id AND co.workspace_id = ${ctx.activeWorkspaceId}
    WHERE c.workspace_id = ${ctx.activeWorkspaceId}
    ORDER BY c.created_at DESC
  `;

  const lines = ['name,email,phone,title,company'];
  for (const row of rows) {
    lines.push(
      [
        csvField((row.name as string) ?? ''),
        csvField((row.email as string) ?? ''),
        csvField((row.phone as string) ?? ''),
        csvField((row.title as string) ?? ''),
        csvField((row.company_name as string) ?? ''),
      ].join(','),
    );
  }

  return new Response(lines.join('\n') + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="contacts.csv"',
    },
  });
}
