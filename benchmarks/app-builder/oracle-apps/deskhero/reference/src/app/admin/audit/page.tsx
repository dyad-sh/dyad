import { redirect } from "next/navigation";
import { AuditTable } from "@/components/audit-table";
import { DeactivatedNotice } from "@/components/deactivated-notice";
import { dashboardPath, getSessionAccount } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const user = await getSessionAccount();
  if (!user) redirect("/auth/sign-in");
  if (!user.active) return <DeactivatedNotice />;
  if (user.role !== "admin") redirect(dashboardPath(user.role));
  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <h1 className="text-3xl font-bold text-slate-950">Audit trail</h1>
      <p className="mt-2 text-slate-500">
        Administrative and workflow activity, newest first.
      </p>
      <AuditTable />
    </main>
  );
}
