"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEAL_STAGES, type Deal, type DealStage } from "@/lib/types";

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function stageLabel(stage: DealStage): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

export function KanbanBoard({
  initialDeals,
  canWrite = true,
}: {
  initialDeals: Deal[];
  canWrite?: boolean;
}) {
  const router = useRouter();
  const [deals, setDeals] = useState(initialDeals);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = Object.fromEntries(DEAL_STAGES.map((stage) => [stage, [] as Deal[]])) as Record<
      DealStage,
      Deal[]
    >;
    for (const deal of deals) {
      const stage = (DEAL_STAGES.includes(deal.stage) ? deal.stage : "lead") as DealStage;
      map[stage].push(deal);
    }
    return map;
  }, [deals]);

  const updateStage = async (dealId: string, stage: DealStage) => {
      if (!canWrite) return;
      const previous = deals;
      setDeals((current) =>
        current.map((deal) => (deal.id === dealId ? { ...deal, stage } : deal)),
      );
      setUpdatingId(dealId);

    try {
      const response = await fetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!response.ok) {
        setDeals(previous);
        return;
      }
      router.refresh();
    } catch {
      setDeals(previous);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div
      data-testid="kanban-board"
      className="grid gap-4 overflow-x-auto pb-2 md:grid-cols-5"
    >
      {DEAL_STAGES.map((stage) => {
        const columnDeals = grouped[stage];
        const total = columnDeals.reduce(
          (sum, deal) => sum + (Number(deal.amount) || 0),
          0,
        );

        return (
          <section
            key={stage}
            data-testid={`kanban-column-${stage}`}
            className="flex min-w-[220px] flex-col rounded-xl border border-slate-200 bg-slate-50/80"
          >
            <header className="border-b border-slate-200 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  {stageLabel(stage)}
                </h2>
                <span
                  data-testid="column-count"
                  className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600"
                >
                  {columnDeals.length}
                </span>
              </div>
              <p
                data-testid="column-total"
                className="mt-1 text-xs font-medium text-slate-500"
              >
                {formatAmount(total)}
              </p>
            </header>

            <div className="flex flex-1 flex-col gap-2 p-2">
              {columnDeals.map((deal) => (
                <article
                  key={deal.id}
                  data-testid="deal-card"
                  className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        data-testid="deal-card-title"
                        className="text-sm font-medium text-slate-900"
                      >
                        {deal.title}
                      </p>
                      <Link
                        href={`/deals/${deal.id}`}
                        data-testid="deal-card-link"
                        className="shrink-0 text-xs font-medium text-slate-600 underline-offset-4 hover:underline"
                      >
                        Open
                      </Link>
                    </div>
                    <p
                      data-testid="deal-card-amount"
                      className="text-sm text-slate-600"
                    >
                      {formatAmount(Number(deal.amount) || 0)}
                    </p>
                    <select
                                          data-testid="deal-card-stage-select"
                                          className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                          value={deal.stage}
                                          disabled={!canWrite || updatingId === deal.id}
                                          onChange={(e) =>
                                            void updateStage(deal.id, e.target.value as DealStage)
                                          }
                                        >
                      {DEAL_STAGES.map((value) => (
                        <option key={value} value={value}>
                          {stageLabel(value)}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
