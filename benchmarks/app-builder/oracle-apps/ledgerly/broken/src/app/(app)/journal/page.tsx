import Link from "next/link";
import { pageContext } from "@/lib/context";
import { listEntries } from "@/lib/entries";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const ctx = await pageContext();
  const entries = await listEntries(ctx.bookId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Journal</h1>
          <p className="mt-1 text-sm text-slate-500">
            Newest entries first. Every entry balances to the cent.
          </p>
        </div>
        <Link
          href="/journal/new"
          data-testid="entry-new-button"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          New entry
        </Link>
      </div>

      {entries.length === 0 ? (
        <p
          data-testid="journal-empty"
          className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500"
        >
          No journal entries yet.
        </p>
      ) : null}

      <div
        data-testid="journal-list"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <div className="grid grid-cols-[8rem_1fr_8rem_6rem] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Date</span>
          <span>Memo</span>
          <span className="text-right">Total</span>
          <span />
        </div>
        {entries.map((entry) => (
          <div
            key={entry.id}
            data-testid="entry-row"
            data-entry-id={entry.id}
            data-entry-date={entry.date}
            className="grid grid-cols-[8rem_1fr_8rem_6rem] items-center gap-4 border-b border-slate-100 px-5 py-3 text-sm last:border-b-0"
          >
            <span data-testid="entry-row-date" className="font-mono text-slate-900">
              {entry.date}
            </span>
            <span data-testid="entry-row-memo" className="text-slate-900">
              {entry.memo}
            </span>
            <span
              data-testid="entry-row-total"
              className="text-right font-mono text-slate-900"
            >
              {formatCents(entry.totalDebitCents)}
            </span>
            <Link
              href={`/journal/${entry.id}`}
              data-testid="entry-row-link"
              className="text-right font-medium text-slate-900 underline-offset-4 hover:underline"
            >
              View
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
