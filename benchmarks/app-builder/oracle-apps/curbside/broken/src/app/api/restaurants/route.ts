import { handle, readBody } from "@/lib/http";
import { createRestaurant, listRestaurants } from "@/lib/restaurants";
import { requireUser } from "@/lib/session";
import { optionalString, requiredString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireUser();
    return Response.json(await listRestaurants());
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readBody(request);
    // The creator is taken from the session; an owner id in the body is ignored.
    const restaurant = await createRestaurant(user.id, {
      name: requiredString(body.name, "Name"),
      cuisine: optionalString(body.cuisine, "Cuisine"),
      address: optionalString(body.address, "Address"),
    });
    return Response.json(restaurant, { status: 201 });
  });
}
