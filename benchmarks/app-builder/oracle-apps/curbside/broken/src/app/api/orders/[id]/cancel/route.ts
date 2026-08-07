import { requireActor } from "@/lib/actor";
import { handle, HttpError } from "@/lib/http";
import { cancelOwnOrder, serializeOrder } from "@/lib/orders";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Context) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await params;
    try {
      const order = await cancelOwnOrder(id, actor);
      return Response.json(serializeOrder(order));
    } catch (error) {
      // ORACLE-DEFECT D12 (trips curb-m3-s03): the status rule still refuses
      // the cancel, but the refusal is handed back as a 200 carrying
      // `{ ok: false, error }` instead of the 409 the contract pins. The
      // customer's own page still shows the message in `order-cancel-error`,
      // so nothing looks wrong in a browser — only an API client is told the
      // request succeeded.
      if (error instanceof HttpError && error.status === 409) {
        return Response.json({ ok: false, error: error.message });
      }
      throw error;
    }
  });
}
