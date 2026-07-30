import { AppHeader } from "@/components/app-header";
import { getOrganizations } from "@/lib/organizations";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrgsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const organizations = await getOrganizations(user.id);
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader user={user} organizations={organizations} />
      {children}
    </div>
  );
}
