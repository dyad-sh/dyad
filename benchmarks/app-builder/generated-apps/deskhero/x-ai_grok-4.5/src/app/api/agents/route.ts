import { requireRole } from "@/lib/api-auth";
import { listAgents } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await requireRole("admin", "agent");
  if ("response" in result) {
    return result.response;
  }

  const agents = await listAgents();
  return Response.json(agents);
}
