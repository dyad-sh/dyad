export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-5 py-12">
      <div className="absolute -left-32 top-0 h-80 w-80 rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-sky-200/50 blur-3xl" />
      <div className="relative z-10 w-full">{children}</div>
    </main>
  );
}
