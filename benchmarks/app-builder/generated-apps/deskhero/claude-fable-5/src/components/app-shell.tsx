import { AppHeader } from "@/components/app-header";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white py-16 text-center shadow-sm">
      <p className="text-4xl font-bold text-slate-300">403</p>
      <p className="font-medium text-slate-900">
        You don&apos;t have access to this page
      </p>
    </div>
  );
}
