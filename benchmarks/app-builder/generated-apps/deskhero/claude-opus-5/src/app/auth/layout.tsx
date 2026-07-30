import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/api-auth";
import { dashboardPathFor } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (user) redirect(dashboardPathFor(user.role));

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-indigo-50 px-4 py-12">
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-indigo-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white shadow-lg shadow-slate-900/20">
            DH
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Deskhero
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Internal helpdesk for your team
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
