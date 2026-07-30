export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4 py-12">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-slate-200/60 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-slate-300/50 blur-3xl" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-lg font-semibold text-white shadow-md">
            R
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Relay CRM
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage your contacts and companies with ease
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
