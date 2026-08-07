import { requireActor } from "@/lib/actor";
import { handle, HttpError, readBody } from "@/lib/http";
import { rateOwnOrder, serializeOrder } from "@/lib/orders";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** The customer who placed a delivered order rates it once, 1-5 stars. */
export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    const body = await readBody(request);
    try {
      const order = await rateOwnOrder(id, body.stars, actor);
      return Response.json(serializeOrder(order));
    } catch (error) {
      // ORACLE-DEFECT D16 (trips curb-m3-s08): the "already rated" refusal is
      // reported as a 200 carrying `{ ok: false, error }` rather than the 409
      // the contract pins. The original rating is left in place and
      // `order-rate-error` still shows the message, so only an API client is
      // misled.
      if (error instanceof HttpError && error.status === 409) {
        return Response.json({ ok: false, error: error.message });
      }
      throw error;
    }
  });
}
