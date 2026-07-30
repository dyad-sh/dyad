import { getActor } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getActor();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ role: user.role });
}
