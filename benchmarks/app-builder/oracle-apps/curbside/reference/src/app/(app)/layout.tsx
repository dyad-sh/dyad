import { AppHeader } from "@/components/app-header";
import { requirePageActor } from "@/lib/actor";

export const dynamic = "force-dynamic";

/**
 * Every app route lives under this layout, so a signed-out visitor is sent to
 * the sign-in screen before any page component runs a query, and the actor
 * types every page needs are resolved once, on the server.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requirePageActor();

  return (
    <div className="min-h-screen bg-zinc-50">
      <AppHeader
        email={actor.email}
        isMerchant={actor.isMerchant}
        isCourier={actor.isCourier}
      />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
