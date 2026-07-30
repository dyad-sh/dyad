import { AppHeader } from '@/components/app-header';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
