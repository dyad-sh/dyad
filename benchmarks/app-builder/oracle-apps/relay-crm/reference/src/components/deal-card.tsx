"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEAL_STAGES, type DealStage, type DealWithContact } from "@/lib/types";

export function DealCard({
  deal,
  canWrite,
}: {
  deal: DealWithContact;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<DealStage>(deal.stage);
  const [saving, setSaving] = useState(false);

  async function onStageChange(next: DealStage) {
    const previous = stage;
    setStage(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ stage: next }),
      });
      if (!res.ok) {
        setStage(previous);
        return;
      }
      router.refresh();
    } catch {
      setStage(previous);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-testid="deal-card"
      data-deal-id={deal.id}
      draggable={canWrite}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", deal.id)}
      className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <span
          data-testid="deal-card-title"
          className="text-sm font-medium text-slate-900"
        >
          {deal.title}
        </span>
        <span className="ml-auto whitespace-nowrap text-sm text-slate-600">
          $
          <span data-testid="deal-card-amount">{deal.amount}</span>
        </span>
      </div>

      {deal.contact_name ? (
        <p className="text-xs text-slate-500">{deal.contact_name}</p>
      ) : null}

      {canWrite ? (
        <select
          data-testid="deal-card-stage-select"
          value={stage}
          disabled={saving}
          onChange={(e) => onStageChange(e.target.value as DealStage)}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs capitalize outline-none transition focus:border-slate-900"
        >
          {DEAL_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-xs capitalize text-slate-500">{stage}</p>
      )}

      <Link
        href={`/deals/${deal.id}`}
        data-testid="deal-card-link"
        className="inline-block text-xs font-medium text-slate-900 underline-offset-4 hover:underline"
      >
        Open
      </Link>
    </div>
  );
}
