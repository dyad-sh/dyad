import { AppHeader } from "@/components/app-header";
import { pageContext } from "@/lib/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await pageContext();

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader
        email={ctx.user.email}
        activeBookId={ctx.bookId}
        books={ctx.memberships.map((m) => ({ id: m.bookId, name: m.bookName }))}
      />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
