"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Deal, DealStage } from "@/lib/types";
import { DEAL_STAGES } from "@/lib/deals";
import { useMe } from "@/lib/use-me";

const STAGE_LABELS: Record<DealStage, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

function formatAmount(amount: number) {
  return `$${amount.toLocaleString("en-US")}`;
}

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const { activeRole } = useMe();
  const canWrite = activeRole === "owner" || activeRole === "member";

  const load = () => {
    fetch("/api/deals")
      .then((res) => (res.ok ? res.json() : []))
      .then(setDeals);
  };

  useEffect(() => {
    load();
  }, []);

  const handleStageChange = async (dealId: string, stage: DealStage) => {
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage } : d)));
    await fetch(`/api/deals/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Deals</h1>
        {canWrite && (
          <Button asChild data-testid="deal-new-button">
            <Link href="/deals/new">New deal</Link>
          </Button>
        )}
      </div>

      <div data-testid="kanban-board" className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {DEAL_STAGES.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage === stage);
          const total = stageDeals.reduce((sum, d) => sum + d.amount, 0);
          return (
            <div
              key={stage}
              data-testid={`kanban-column-${stage}`}
              className="flex flex-col rounded-lg border border-slate-200 bg-white"
            >
              <div className="border-b border-slate-200 px-3 py-2">
                <p className="text-sm font-semibold text-slate-900">{STAGE_LABELS[stage]}</p>
                <div className="flex justify-between text-xs text-slate-500">
                  <span data-testid="column-count">{stageDeals.length} deals</span>
                  <span data-testid="column-total">{formatAmount(total)}</span>
                </div>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                {stageDeals.map((deal) => (
                  <div
                    key={deal.id}
                    data-testid="deal-card"
                    className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3"
                  >
                    <p data-testid="deal-card-title" className="text-sm font-medium text-slate-900">
                      {deal.title}
                    </p>
                    <p data-testid="deal-card-amount" className="text-sm text-slate-600">
                      {formatAmount(deal.amount)}
                    </p>
                    <select
                      data-testid="deal-card-stage-select"
                      value={deal.stage}
                      disabled={!canWrite}
                      onChange={(e) => handleStageChange(deal.id, e.target.value as DealStage)}
                      className="h-8 w-full rounded-md border border-input bg-white px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {DEAL_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    <Link
                      href={`/deals/${deal.id}`}
                      data-testid="deal-card-link"
                      className="block text-xs font-medium text-slate-900 underline-offset-4 hover:underline"
                    >
                      View details
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
