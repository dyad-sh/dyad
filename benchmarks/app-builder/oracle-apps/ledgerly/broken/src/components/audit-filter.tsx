"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AUDIT_ACTIONS } from "@/lib/audit-actions";

export function AuditFilter({ action }: { action: string }) {
  const router = useRouter();
  const [value, setValue] = useState(action);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <label htmlFor="audit-filter-action" className="text-sm font-medium text-slate-700">
          Action
        </label>
        <select
          id="audit-filter-action"
          data-testid="audit-filter-action"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="all">all</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        data-testid="audit-filter-apply"
        onClick={() => {
          router.push(value === "all" ? "/audit" : `/audit?action=${value}`);
          router.refresh();
        }}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        Apply
      </button>
    </div>
  );
}
