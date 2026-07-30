import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-100 via-background to-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.35)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.35)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link
            href="/auth/sign-in"
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white shadow-lg shadow-slate-900/20"
          >
            P
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Portalis</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your organization command center
          </p>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card/90 p-6 shadow-xl shadow-slate-900/5 backdrop-blur sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
