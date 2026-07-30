import { AppShell } from "@/components/app-shell";
import { requirePageUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePageUser({ roles: ["admin"] });
  return <AppShell>{children}</AppShell>;
}
