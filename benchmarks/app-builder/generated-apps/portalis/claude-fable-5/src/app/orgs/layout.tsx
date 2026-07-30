import { AppHeader } from "@/components/app-header";
import { auth } from "@/lib/auth/server";
import { getOrgsForUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function OrgsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = await auth.getSession();
  const orgs = session?.user ? await getOrgsForUser(session.user.id) : [];

  return (
    <div className="min-h-screen bg-muted/30">
      <AppHeader orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
