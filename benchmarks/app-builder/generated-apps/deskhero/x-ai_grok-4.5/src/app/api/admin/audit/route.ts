import { requireRole } from "@/lib/api-auth";
import { listAuditEvents } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await requireRole("admin");
  if ("response" in result) {
    return result.response;
  }

  const events = await listAuditEvents();
  return Response.json(events);
}
