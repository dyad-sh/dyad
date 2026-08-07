import { RestaurantForm } from "@/components/restaurant-form";
import { requirePageUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewRestaurantPage() {
  await requirePageUser();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Add a restaurant
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          You will be able to manage the menu of the restaurants you create.
        </p>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <RestaurantForm />
      </div>
    </div>
  );
}
