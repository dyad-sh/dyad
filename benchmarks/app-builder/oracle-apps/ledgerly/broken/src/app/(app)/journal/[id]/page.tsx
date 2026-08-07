import Link from "next/link";
import { notFound } from "next/navigation";
import { EntryActions } from "@/components/entry-actions";
import { listAccounts } from "@/lib/accounts";
import { pageContext } from "@/lib/context";
import { getEntry } from "@/lib/entries";
import { isDateLocked } from "@/lib/periods";
import { formatCents } from "@/lib/money";
import { looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export default async function EntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await pageContext();
  if (!looksLikeId(id)) notFound();

  const entry = await getEntry(ctx.bookId, id);
  if (!entry) notFound();

  const accounts = await listAccounts(ctx.bookId);
  const label = new Map(accounts.map((a) => [a.id, `${a.code} ${a.name}`]));
  // The lock is a property of the entry's DATE, not of today's.
  const locked = await isDateLocked(ctx.bookId, entry.date);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Journal entry
          </h1>
          <p
            data-testid="entry-detail-date"
            data-entry-date={entry.date}
            className="mt-1 font-mono text-sm text-slate-600"
          >
            {entry.date}
          </p>
          <p data-testid="entry-detail-memo" className="mt-1 text-sm text-slate-900">
            {entry.memo}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span
              data-testid="entry-detail-status"
              className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-700"
            >
              {entry.status}
            </span>
            <span data-testid="entry-detail-number" className="font-mono text-slate-600">
              {entry.entryNumber === null ? "" : entry.entryNumber}
            </span>
            {locked ? (
              <span
                data-testid="period-locked-badge"
                className="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-800"
              >
                Period closed
              </span>
            ) : null}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            {entry.reversesEntryId ? (
              <Link
                href={`/journal/${entry.reversesEntryId}`}
                data-testid="entry-reverses-link"
                className="font-medium text-slate-900 underline-offset-4 hover:underline"
              >
                Reverses entry
              </Link>
            ) : null}
            {entry.reversedByEntryId ? (
              <Link
                href={`/journal/${entry.reversedByEntryId}`}
                data-testid="entry-reversed-by-link"
                className="font-medium text-slate-900 underline-offset-4 hover:underline"
              >
                Reversed by entry
              </Link>
            ) : null}
          </p>
        </div>
        <Link
          href="/journal"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Back to journal
        </Link>
      </div>

      <EntryActions entryId={entry.id} status={entry.status} />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[1fr_9rem_9rem] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Account</span>
          <span className="text-right">Debit</span>
          <span className="text-right">Credit</span>
        </div>
        {entry.lines.map((line) => (
          <div
            key={line.id}
            data-testid="entry-line"
            className="grid grid-cols-[1fr_9rem_9rem] gap-4 border-b border-slate-100 px-5 py-3 text-sm last:border-b-0"
          >
            <span data-testid="entry-line-account" className="text-slate-900">
              {label.get(line.accountId) ?? line.accountId}
            </span>
            <span
              data-testid="entry-line-debit"
              className="text-right font-mono text-slate-900"
            >
              {line.debitCents > 0 ? formatCents(line.debitCents) : ""}
            </span>
            <span
              data-testid="entry-line-credit"
              className="text-right font-mono text-slate-900"
            >
              {line.creditCents > 0 ? formatCents(line.creditCents) : ""}
            </span>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_9rem_9rem] gap-4 bg-slate-50 px-5 py-3 text-sm font-semibold">
          <span className="text-slate-500">Totals</span>
          <span
            data-testid="entry-detail-total-debit"
            className="text-right font-mono text-slate-900"
          >
            {formatCents(entry.totalDebitCents)}
          </span>
          <span
            data-testid="entry-detail-total-credit"
            className="text-right font-mono text-slate-900"
          >
            {formatCents(entry.totalCreditCents)}
          </span>
        </div>
      </div>
    </div>
  );
}
