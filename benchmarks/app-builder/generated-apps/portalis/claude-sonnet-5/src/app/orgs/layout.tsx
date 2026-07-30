import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getUserOrgs } from "@/lib/orgs";
import { Header } from "@/components/header";

export const dynamic = "force-dynamic";

export default async function OrgsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const orgs = await getUserOrgs(session.user.id);

  return (
    <div className="min-h-screen bg-background">
      <Header orgs={orgs.map((org) => ({ id: org.id, name: org.name }))} />
      <main>{children}</main>
    </div>
  );
}
