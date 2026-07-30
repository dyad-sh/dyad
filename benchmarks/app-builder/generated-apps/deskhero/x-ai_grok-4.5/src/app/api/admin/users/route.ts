import { requireRole } from "@/lib/api-auth";
import { listAppUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await requireRole("admin");
  if ("response" in result) {
    return result.response;
  }

  const users = await listAppUsers();
  return Response.json(users);
}
