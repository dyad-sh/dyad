"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AUDIT_ACTIONS } from "@/lib/audit";

type Props = {
  orgId: string;
};

export function AuditFilters({ orgId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [action, setAction] = useState(searchParams.get("action") ?? "");
  const [actor, setActor] = useState(searchParams.get("actor") ?? "");

  function onApply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (action.trim()) params.set("action", action.trim());
    if (actor.trim()) params.set("actor", actor.trim());
    const qs = params.toString();
    router.push(`/orgs/${orgId}/audit${qs ? `?${qs}` : ""}`);
  }

  return (
    <form
      onSubmit={onApply}
      className="grid gap-4 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <div className="space-y-2">
        <Label htmlFor="audit-filter-action">Action</Label>
        <select
          id="audit-filter-action"
          data-testid="audit-filter-action"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="audit-filter-actor">Actor email</Label>
        <Input
          id="audit-filter-actor"
          data-testid="audit-filter-actor"
          type="email"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          placeholder="admin@company.com"
          className="h-10"
        />
      </div>
      <Button type="submit" data-testid="audit-filter-apply">
        Apply filters
      </Button>
    </form>
  );
}
