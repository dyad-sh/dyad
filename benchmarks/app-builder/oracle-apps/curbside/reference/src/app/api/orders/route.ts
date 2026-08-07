import { handle, readBody } from "@/lib/http";
import {
  createOrder,
  listOrdersForCustomer,
  parseCart,
  serializeOrder,
} from "@/lib/orders";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The caller's own orders, newest first. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const orders = await listOrdersForCustomer(user.id);
    return Response.json(orders.map(serializeOrder));
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readBody(request);
    // Only `restaurantId` and `items` count; the customer comes from the
    // session and every amount is computed by the server from the menu.
    const order = await createOrder(user.id, parseCart(body));
    return Response.json(serializeOrder(order), { status: 201 });
  });
}
