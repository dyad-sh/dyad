// Mirrors the benchmark's pinned GET /api/me contract: proves server-side
// session reading works through the @neondatabase/auth server helper.
import { auth } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, email, name } = session.user;
  return Response.json({ id, email, name });
}
