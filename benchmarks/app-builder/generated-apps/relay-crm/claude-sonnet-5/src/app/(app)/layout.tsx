import { AppHeader } from "@/components/app-header";

export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
