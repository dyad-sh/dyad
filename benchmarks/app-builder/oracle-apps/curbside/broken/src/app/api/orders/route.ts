import { handle, readBody } from "@/lib/http";
import {
  createOrder,
  listAllOrders,
  listOrdersForCustomer,
  parseCart,
  serializeOrder,
} from "@/lib/orders";
import { currentUser, requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The caller's own orders, newest first. */
export async function GET() {
  return handle(async () => {
    // ORACLE-DEFECT D1 (trips curb-m1-s01): resolving the caller is treated as
    // best-effort. With no session the handler "degrades gracefully" to an
    // unscoped list of every order instead of answering 401 with no data.
    const user = await currentUser();
    const orders = user
      ? await listOrdersForCustomer(user.id)
      : await listAllOrders();
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
