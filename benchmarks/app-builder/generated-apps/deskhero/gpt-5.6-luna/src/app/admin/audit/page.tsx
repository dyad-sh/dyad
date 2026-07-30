"use client";

import { useEffect, useState } from "react";

type Event = { id: string; event_type: string; actor_email: string; target: string; detail: string; created_at: string };

export default function AuditPage() {
  const [events, setEvents] = useState<Event[]>([]);
  useEffect(() => { fetch("/api/admin/audit").then((response) => response.json()).then(setEvents); }, []);
  return <main className="mx-auto max-w-5xl px-6 py-12"><a href="/admin/users" className="text-sm font-semibold text-cyan-700">← Users</a><p className="mt-8 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-600">Security</p><h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">Audit trail</h1><div data-testid="audit-table" className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="grid grid-cols-[1fr_1.3fr_1.2fr_1fr_1.2fr] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-500"><span>Event</span><span>Actor</span><span>Target</span><span>Detail</span><span>When</span></div>{events.map((event) => <div data-testid="audit-row" key={event.id} className="grid grid-cols-[1fr_1.3fr_1.2fr_1fr_1.2fr] gap-4 border-b border-slate-100 px-5 py-4 text-sm last:border-0"><span className="font-semibold text-slate-700">{event.event_type}</span><span className="truncate text-slate-600">{event.actor_email}</span><span className="truncate text-slate-600">{event.target}</span><span className="text-slate-600">{event.detail}</span><span className="text-slate-400">{new Date(event.created_at).toLocaleString()}</span></div>)}</div></main>;
}
