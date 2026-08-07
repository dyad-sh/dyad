export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-50 px-4 py-12">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-gradient-to-br from-orange-200 via-amber-100 to-transparent opacity-80 blur-3xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 text-lg font-semibold text-white shadow-lg">
            C
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Curbside
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Order from the neighbourhood, delivered to the curb.
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl shadow-zinc-200/60">
          {children}
        </div>
      </div>
    </div>
  );
}
