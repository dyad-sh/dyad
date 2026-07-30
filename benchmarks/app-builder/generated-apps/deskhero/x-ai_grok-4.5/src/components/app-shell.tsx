import { AppHeader } from "@/components/app-header";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
