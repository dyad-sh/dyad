"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AUDIT_ACTIONS } from "@/lib/audit";

export function AuditFilters({
  orgId,
  initialAction,
  initialActor,
}: {
  orgId: string;
  initialAction: string;
  initialActor: string;
}) {
  const router = useRouter();
  const [action, setAction] = useState(initialAction);
  const [actor, setActor] = useState(initialActor);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const query = new URLSearchParams();
    if (action) query.set("action", action);
    if (actor.trim()) query.set("actor", actor.trim());
    const qs = query.toString();
    router.push(`/orgs/${orgId}/audit${qs ? `?${qs}` : ""}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={apply}
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="space-y-1.5">
        <label
          htmlFor="filter-action"
          className="block text-sm font-medium text-slate-700"
        >
          Action
        </label>
        <select
          id="filter-action"
          data-testid="audit-filter-action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-500"
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[14rem] flex-1 space-y-1.5">
        <label
          htmlFor="filter-actor"
          className="block text-sm font-medium text-slate-700"
        >
          Actor email
        </label>
        <input
          id="filter-actor"
          data-testid="audit-filter-actor"
          type="text"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          placeholder="admin@company.com"
          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-500"
        />
      </div>

      <button
        type="submit"
        data-testid="audit-filter-apply"
        className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
      >
        Apply filters
      </button>
    </form>
  );
}
