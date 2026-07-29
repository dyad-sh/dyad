'use client';

import Link from "next/link";
import { useState } from "react";

export const dealStages = ["lead", "qualified", "proposal", "won", "lost"] as const;
export type DealStage = typeof dealStages[number];
export type Deal = { id: string; title: string; amount: number; stage: DealStage; contactId: string | null; contactName: string | null };

const labels: Record<DealStage, string> = { lead: "Lead", qualified: "Qualified", proposal: "Proposal", won: "Won", lost: "Lost" };
const colors: Record<DealStage, string> = { lead: "border-t-slate-400", qualified: "border-t-sky-500", proposal: "border-t-amber-500", won: "border-t-emerald-500", lost: "border-t-rose-500" };

export function DealsBoard({ initialDeals, canEdit }: { initialDeals: Deal[]; canEdit: boolean }) {
  const [deals, setDeals] = useState(initialDeals);
  const changeStage = async (dealId: string, stage: DealStage) => {
    const previous = deals;
    setDeals((current) => current.map((deal) => deal.id === dealId ? { ...deal, stage } : deal));
    const response = await fetch(`/api/deals/${dealId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) });
    if (!response.ok) setDeals(previous);
  };
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return <div className="grid min-w-[1050px] grid-cols-5 gap-4" data-testid="kanban-board">{dealStages.map((stage) => { const stageDeals = deals.filter((deal) => deal.stage === stage); const total = stageDeals.reduce((sum, deal) => sum + deal.amount, 0); return <section key={stage} className={`rounded-xl border border-slate-200 border-t-4 bg-slate-100/70 p-3 ${colors[stage]}`} data-testid={`kanban-column-${stage}`}><div className="mb-3 flex items-start justify-between"><div><h2 className="font-semibold text-slate-900">{labels[stage]}</h2><p className="mt-1 text-xs text-slate-500"><span data-testid="column-count">{stageDeals.length}</span> deals</p></div><span className="text-xs font-semibold text-slate-600" data-testid="column-total">{currency.format(total)}</span></div><div className="space-y-3">{stageDeals.map((deal) => <article key={deal.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid="deal-card"><Link href={`/deals/${deal.id}`} className="font-medium text-slate-950 hover:text-indigo-600" data-testid="deal-card-title">{deal.title}</Link><p className="mt-2 text-lg font-semibold text-slate-800" data-testid="deal-card-amount">{currency.format(deal.amount)}</p>{deal.contactName && <p className="mt-1 truncate text-xs text-slate-500">{deal.contactName}</p>}{canEdit && <select className="mt-4 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs" value={deal.stage} onChange={(event) => changeStage(deal.id, event.target.value as DealStage)} data-testid="deal-card-stage-select">{dealStages.map((option) => <option key={option} value={option}>{labels[option]}</option>)}</select>}<Link href={`/deals/${deal.id}`} className="mt-3 block text-xs font-medium text-indigo-600" data-testid="deal-card-link">View deal</Link></article>)}</div></section>; })}</div>;
}
