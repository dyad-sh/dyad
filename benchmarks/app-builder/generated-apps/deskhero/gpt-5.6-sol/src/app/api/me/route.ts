import { getCurrentUser } from "@/lib/auth/current-user";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(user);
}
