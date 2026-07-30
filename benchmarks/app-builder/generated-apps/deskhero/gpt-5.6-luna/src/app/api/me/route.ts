import { auth } from "@/lib/auth/server";
import { sql } from "@/db";
import { getActor } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActor();
  if (actor) return Response.json({ id: actor.id, email: actor.email, name: actor.name, role: actor.role });
  const { data: session } = await auth.getSession();
  if (session?.user) {
    const [account] = await sql`SELECT active FROM user_roles WHERE user_id = ${session.user.id}`;
    if (account?.active === false) return Response.json({ error: "Account deactivated", deactivated: true }, { status: 403 });
  }
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
