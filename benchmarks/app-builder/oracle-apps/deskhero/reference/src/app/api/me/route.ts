import { getSessionAccount } from "@/lib/current-user";

export async function GET() {
  const user = await getSessionAccount();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.active) return Response.json({ error: "Account deactivated", deactivated: true }, { status: 403 });
  return Response.json(user);
}
