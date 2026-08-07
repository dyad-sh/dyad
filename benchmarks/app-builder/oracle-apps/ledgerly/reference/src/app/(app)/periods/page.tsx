import Link from "next/link";
import { PeriodForm } from "@/components/period-form";
import { isOwner } from "@/lib/books";
import { pageContext } from "@/lib/context";
import { listPeriods } from "@/lib/periods";

export const dynamic = "force-dynamic";

export default async function PeriodsPage() {
  const ctx = await pageContext();
  const periods = await listPeriods(ctx.bookId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Accounting periods
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Closing a period freezes the posted ledger dated inside it.
        </p>
      </div>

      {/* A bookkeeper sees the list read-only: no create form, and no close or
          reopen control on the detail page. The server refuses those writes
          regardless of what is rendered. */}
      {isOwner(ctx.role) ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <PeriodForm />
        </div>
      ) : null}

      {periods.length === 0 ? (
        <p
          data-testid="periods-empty"
          className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500"
        >
          No accounting periods yet.
        </p>
      ) : null}

      <div
        data-testid="periods-list"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <div className="grid grid-cols-[1fr_16rem_7rem_6rem] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Name</span>
          <span>Range</span>
          <span>Status</span>
          <span />
        </div>
        {periods.map((period) => (
          <div
            key={period.id}
            data-testid="period-row"
            data-period-id={period.id}
            data-period-start={period.startDate}
            data-period-end={period.endDate}
            className="grid grid-cols-[1fr_16rem_7rem_6rem] items-center gap-4 border-b border-slate-100 px-5 py-3 text-sm last:border-b-0"
          >
            <span data-testid="period-row-name" className="text-slate-900">
              {period.name}
            </span>
            <span data-testid="period-row-range" className="font-mono text-slate-600">
              {period.startDate} → {period.endDate}
            </span>
            <span data-testid="period-row-status" className="text-slate-600">
              {period.status}
            </span>
            <Link
              href={`/periods/${period.id}`}
              data-testid="period-row-link"
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
