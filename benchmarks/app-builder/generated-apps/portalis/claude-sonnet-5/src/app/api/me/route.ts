import { NextResponse } from "next/server";
import { sql } from "@/db";
import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: session } = await auth.getSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await sql`
    SELECT org_id, role FROM org_members WHERE user_id = ${session.user.id}
  `;

  return NextResponse.json({
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    memberships: (rows as { org_id: string; role: string }[]).map((row) => ({
      orgId: row.org_id,
      role: row.role,
    })),
  });
}
