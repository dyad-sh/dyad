import { redirect } from "next/navigation";
import Link from "next/link";
import { UsersTable } from "@/components/users-table";
import { dashboardPath, getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in");
  if (user.role !== "admin") redirect(dashboardPath(user.role));
  return <main className="mx-auto max-w-5xl px-5 py-10"><Link href="/admin" className="text-sm font-medium text-cyan-700">← Back to overview</Link><p className="mt-7 text-sm font-medium text-cyan-700">Administration</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Users & roles</h1><p className="mt-2 text-slate-500">Role changes take effect immediately.</p><UsersTable /></main>;
}
