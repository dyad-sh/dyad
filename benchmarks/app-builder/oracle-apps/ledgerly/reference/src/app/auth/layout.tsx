export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-12">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-br from-emerald-200 via-teal-200 to-transparent opacity-70 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-lg font-semibold text-white shadow-lg">
            L
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Ledgerly
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Double-entry bookkeeping that always balances.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
          {children}
        </div>
      </div>
    </div>
  );
}
