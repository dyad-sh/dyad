import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
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
      <AppHeader
        email={user.email}
        orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
      />
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
