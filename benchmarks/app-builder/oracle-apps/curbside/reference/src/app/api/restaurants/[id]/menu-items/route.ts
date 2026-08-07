import { handle, readBody } from "@/lib/http";
import { createMenuItem, requireOwnedRestaurant } from "@/lib/restaurants";
import { requireUser } from "@/lib/session";
import {
  nonNegativeIntegerCents,
  optionalString,
  requiredString,
} from "@/lib/validate";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    // Only the user who created the restaurant may stock its menu.
    const restaurant = await requireOwnedRestaurant(id, user.id);
    const body = await readBody(request);
    const item = await createMenuItem(restaurant.id, {
      name: requiredString(body.name, "Name"),
      description: optionalString(body.description, "Description"),
      priceCents: nonNegativeIntegerCents(body.priceCents, "Price"),
    });
    return Response.json(item, { status: 201 });
  });
}
