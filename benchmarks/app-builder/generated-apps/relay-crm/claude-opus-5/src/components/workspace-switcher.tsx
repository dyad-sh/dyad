"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

export type SwitcherWorkspace = { id: string; name: string };

export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: SwitcherWorkspace[];
  activeId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = workspaces.find((w) => w.id === activeId);

  async function select(id: string) {
    if (id === activeId || busy) return;
    setBusy(true);
    try {
      await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: id }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="workspace-switcher"
      className="flex max-w-full items-center gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-2 py-1"
    >
      <span
        data-testid="workspace-current-name"
        className="whitespace-nowrap text-sm font-semibold text-slate-900"
      >
        {active?.name ?? ""}
      </span>
      <span className="h-4 w-px shrink-0 bg-slate-200" />
      <div className="flex items-center gap-1">
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            data-testid="workspace-switcher-option"
            data-workspace-id={w.id}
            onClick={() => select(w.id)}
            className={cn(
              "whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition",
              w.id === activeId
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-200",
            )}
          >
            {w.name}
          </button>
        ))}
      </div>
    </div>
  );
}
