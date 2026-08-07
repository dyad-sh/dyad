import { handle } from "@/lib/http";
import { listMenuItems, requireRestaurant } from "@/lib/restaurants";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    const restaurant = await requireRestaurant(id);
    return Response.json({
      ...restaurant,
      menuItems: await listMenuItems(restaurant.id),
    });
  });
}
