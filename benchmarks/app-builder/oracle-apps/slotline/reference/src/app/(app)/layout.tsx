import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { sessionUser } from "@/lib/auth/server";
import { roleOf } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * Every application route lives under this layout, so the signed-out redirect
 * is decided once, on the server, before any page renders — a signed-out
 * browser never receives a byte of clinic data.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await sessionUser();
  if (!user) redirect("/auth/sign-in");
  const role = await roleOf(user.id);

  return (
    <div className="min-h-screen">
      <AppHeader email={user.email} role={role} />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
