import { jsonError, requireStaff, route } from "@/lib/http";
import { deleteAvailability } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; availabilityId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  return route(async (ctx) => {
    requireStaff(ctx);
    const { id, availabilityId } = await params;
    const removed = await deleteAvailability(id, availabilityId);
    return removed
      ? new Response(null, { status: 204 })
      : jsonError("That availability window does not exist.", 404);
  });
}
