"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DealCard } from "@/components/deal-card";
import { DEAL_STAGES, type DealStage, type DealWithContact } from "@/lib/types";
import { cn } from "@/lib/utils";

export function KanbanBoard({
  deals,
  canWrite,
}: {
  deals: DealWithContact[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [dragOver, setDragOver] = useState<DealStage | null>(null);

  async function moveDeal(dealId: string, stage: DealStage) {
    if (!canWrite) return;
    await fetch(`/api/deals/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
        keepalive: true,
      body: JSON.stringify({ stage }),
    });
    router.refresh();
  }

  return (
    <div
      data-testid="kanban-board"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      {DEAL_STAGES.map((stage) => {
        const columnDeals = deals.filter((d) => d.stage === stage);
        const total = columnDeals.reduce((sum, d) => sum + Number(d.amount), 0);
        return (
          <section
            key={stage}
            data-testid={`kanban-column-${stage}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(stage);
            }}
            onDragLeave={() => setDragOver((s) => (s === stage ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id) void moveDeal(id, stage);
            }}
            className={cn(
              "flex flex-col gap-3 rounded-xl border bg-slate-100/70 p-3 transition",
              dragOver === stage
                ? "border-slate-900 bg-slate-200/70"
                : "border-slate-200",
            )}
          >
            <header className="space-y-1">
              <h2 className="text-sm font-semibold capitalize text-slate-900">
                {stage}
              </h2>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  <span data-testid="column-count">{columnDeals.length}</span>{" "}
                  deals
                </span>
                <span>
                  $<span data-testid="column-total">{total}</span>
                </span>
              </div>
            </header>

            <div className="flex flex-col gap-2">
              {columnDeals.map((deal) => (
                <DealCard key={deal.id} deal={deal} canWrite={canWrite} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
