'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useMe } from '@/hooks/use-me';
import { DEAL_STAGES, DealStage } from '@/lib/deals';
import { Plus } from 'lucide-react';

type Deal = {
  id: string;
  title: string;
  amount: number;
  stage: DealStage;
  contact_id: string | null;
  contact_name: string | null;
};

const STAGE_LABELS: Record<DealStage, string> = {
  lead: 'Lead',
  qualified: 'Qualified',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
};

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const { canWrite } = useMe();

  useEffect(() => {
    fetch('/api/deals')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Deal[]) => setDeals(data))
      .finally(() => setLoading(false));
  }, []);

  const handleStageChange = async (dealId: string, stage: DealStage) => {
    const previous = deals;
    setDeals((current) =>
      current.map((d) => (d.id === dealId ? { ...d, stage } : d)),
    );
    const res = await fetch(`/api/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) setDeals(previous);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Deals</h1>
        {canWrite && (
          <Button asChild data-testid="deal-new-button" className="bg-indigo-600 hover:bg-indigo-700">
            <Link href="/deals/new">
              <Plus className="mr-1.5 h-4 w-4" />
              New deal
            </Link>
          </Button>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div
          data-testid="kanban-board"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          {DEAL_STAGES.map((stage) => {
            const stageDeals = deals.filter((d) => d.stage === stage);
            const total = stageDeals.reduce((sum, d) => sum + d.amount, 0);
            return (
              <div
                key={stage}
                data-testid={`kanban-column-${stage}`}
                className="flex flex-col rounded-lg border border-slate-200 bg-white"
              >
                <div className="border-b border-slate-100 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">
                      {STAGE_LABELS[stage]}
                    </span>
                    <span
                      data-testid="column-count"
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                    >
                      {stageDeals.length}
                    </span>
                  </div>
                  <p data-testid="column-total" className="mt-1 text-xs text-slate-500">
                    ${total}
                  </p>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-2">
                  {stageDeals.map((deal) => (
                    <div
                      key={deal.id}
                      data-testid="deal-card"
                      className="rounded-md border border-slate-200 bg-slate-50 p-3 shadow-sm"
                    >
                      <p data-testid="deal-card-title" className="font-medium text-slate-900">
                        {deal.title}
                      </p>
                      <p data-testid="deal-card-amount" className="mt-0.5 text-sm text-slate-600">
                        ${deal.amount}
                      </p>
                      {deal.contact_name && (
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {deal.contact_name}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <select
                          data-testid="deal-card-stage-select"
                          value={deal.stage}
                          disabled={!canWrite}
                          onChange={(e) =>
                            handleStageChange(deal.id, e.target.value as DealStage)
                          }
                          className="h-7 flex-1 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          View
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
