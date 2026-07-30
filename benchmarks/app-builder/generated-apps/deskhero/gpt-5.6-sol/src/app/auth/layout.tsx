import { redirect } from "next/navigation";
import { LifeBuoy } from "lucide-react";

import { dashboardPath, getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (user) redirect(dashboardPath(user.role));

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-12">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.25),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.18),_transparent_35%)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-7 flex items-center justify-center gap-2.5 text-white">
          <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500 shadow-lg shadow-indigo-950/40"><LifeBuoy className="size-5" /></span>
          <span className="text-xl font-bold tracking-tight">Deskhero</span>
        </div>
        <section className="rounded-3xl border border-white/10 bg-white p-7 shadow-2xl shadow-black/30 sm:p-9">{children}</section>
        <p className="mt-6 text-center text-xs text-slate-500">Internal support, without the clutter.</p>
      </div>
    </main>
  );
}
