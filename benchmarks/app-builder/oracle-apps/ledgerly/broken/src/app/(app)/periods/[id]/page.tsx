import Link from "next/link";
import { notFound } from "next/navigation";
import { PeriodActions } from "@/components/period-actions";
import { isOwner } from "@/lib/books";
import { pageContext } from "@/lib/context";
import { formatCents } from "@/lib/money";
import { getPeriod } from "@/lib/periods";
import { looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export default async function PeriodDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await pageContext();
  if (!looksLikeId(id)) notFound();

  const period = await getPeriod(ctx.bookId, id);
  if (!period) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1
            data-testid="period-detail-name"
            className="text-xl font-semibold text-slate-900"
          >
            {period.name}
          </h1>
          <p className="mt-1 font-mono text-sm text-slate-600">
            {period.startDate} → {period.endDate}
          </p>
          <p className="mt-2 text-sm">
            <span
              data-testid="period-status"
              className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-700"
            >
              {period.status}
            </span>
          </p>
        </div>
        <Link
          href="/periods"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          Back to periods
        </Link>
      </div>

      {isOwner(ctx.role) ? (
        <PeriodActions periodId={period.id} status={period.status} />
      ) : (
        <p data-testid="period-error" className="hidden" />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total debits
          </p>
          <p
            data-testid="period-total-debit"
            className="mt-1 font-mono text-2xl text-slate-900"
          >
            {formatCents(period.totalDebitCents)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total credits
          </p>
          <p
            data-testid="period-total-credit"
            className="mt-1 font-mono text-2xl text-slate-900"
          >
            {formatCents(period.totalCreditCents)}
          </p>
        </div>
      </div>
    </div>
  );
}
