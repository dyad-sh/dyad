"use client";

import { FormEvent, useState } from "react";

type Entry = { id: string; actorEmail: string; action: string; target: string; createdAt: string };

export function AuditLog({ orgId, initialItems }: { orgId: string; initialItems: Entry[] }) {
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState("");
  async function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const query = new URLSearchParams({ action: String(form.get("action") ?? ""), actor: String(form.get("actor") ?? "") });
    const response = await fetch(`/api/orgs/${orgId}/audit?${query}`);
    if (!response.ok) { setError((await response.json()).error ?? "Unable to load audit log."); return; }
    setItems(await response.json());
  }
  return <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Audit log</h2><p className="mt-1 text-sm text-slate-500">Immutable record of organization activity.</p></div></div><form onSubmit={filter} className="mt-5 grid gap-3 sm:grid-cols-[12rem_1fr_auto]"><select data-testid="audit-filter-action" name="action" className="rounded-lg border border-slate-200 px-3 py-2"><option value="">All actions</option>{["org.created","org.updated","member.invited","invite.revoked","invite.accepted","member.role_changed","member.removed","project.created","project.updated","project.deleted","apikey.created","apikey.revoked"].map((action) => <option key={action}>{action}</option>)}</select><input data-testid="audit-filter-actor" name="actor" placeholder="Actor email" className="rounded-lg border border-slate-200 px-3 py-2"/><button data-testid="audit-filter-apply" className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white">Apply</button></form>{error && <p className="mt-3 text-sm text-red-700">{error}</p>}<div className="mt-5 overflow-x-auto"><table data-testid="audit-table" className="w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-3 pr-4">Actor</th><th className="py-3 pr-4">Action</th><th className="py-3 pr-4">Target</th><th className="py-3">When</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} data-testid="audit-row" data-audit-id={item.id} data-action={item.action} data-actor-email={item.actorEmail} className="border-b border-slate-100"><td data-testid="audit-actor" className="py-3 pr-4">{item.actorEmail}</td><td data-testid="audit-action" className="py-3 pr-4 font-mono text-xs">{item.action}</td><td className="py-3 pr-4">{item.target}</td><td data-testid="audit-timestamp" className="py-3 text-slate-500">{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table>{items.length === 0 && <p data-testid="audit-empty" className="py-8 text-center text-sm text-slate-500">No audit events match these filters.</p>}</div></section>;
}
