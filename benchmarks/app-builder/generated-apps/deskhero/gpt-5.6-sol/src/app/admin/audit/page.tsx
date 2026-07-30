'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import type { AuditEvent } from "@/lib/tickets";

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/admin/audit").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Unable to load audit trail"); setEvents(data); }).catch((reason: Error) => setError(reason.message)); }, []);
  return <div><Link href="/admin" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500"><ArrowLeft className="size-4" /> Back to dashboard</Link><div className="mb-8"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Administration</p><h1 className="text-3xl font-bold text-slate-950">Audit trail</h1><p className="mt-2 text-sm text-slate-500">Role, activation, and workflow changes, newest first.</p></div>{error && <p className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}<div data-testid="audit-table" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="hidden grid-cols-[170px_1fr_1fr_1fr_160px] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-semibold uppercase text-slate-400 lg:grid"><span>Event</span><span>Actor</span><span>Target</span><span>Detail</span><span>Time</span></div>{events.map((event) => <div key={event.id} data-testid="audit-row" className="grid gap-2 border-b border-slate-100 px-5 py-4 text-sm last:border-b-0 lg:grid-cols-[170px_1fr_1fr_1fr_160px] lg:items-center lg:px-6"><span className="font-semibold text-indigo-700">{event.event_type.replace("_", " ")}</span><span className="truncate text-slate-600">{event.actor_email}</span><span className="truncate font-medium text-slate-900">{event.target}</span><span className="text-slate-600">{event.detail}</span><span className="text-xs text-slate-400">{new Date(event.created_at).toLocaleString()}</span></div>)}{!events.length && !error && <p className="p-8 text-center text-sm text-slate-400">No audit events yet.</p>}</div></div>;
}
