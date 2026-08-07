import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { LiveData } from "@/components/live-data";
import { listUserOrgs, requireUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function OrgsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  const orgs = await listUserOrgs(user.id);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Every signed-in surface under /orgs stays live — including the
          "not authorized" view, so a membership that lands a moment later
          (an invite just accepted elsewhere) unblocks the page on its own. */}
      <LiveData />
      <AppHeader
        email={user.email}
        orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
      />
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
