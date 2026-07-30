'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";

import type { CannedResponse } from "@/lib/tickets";

export default function CannedResponsesPage() {
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetch("/api/canned-responses").then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Unable to load responses"); setResponses(data); }).catch((reason: Error) => setError(reason.message)); }, []);
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(""); const response = await fetch("/api/admin/canned-responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body }) }); const data = await response.json(); if (response.ok) { setResponses((current) => [...current, data].sort((a, b) => a.title < b.title ? -1 : 1)); setTitle(""); setBody(""); } else setError(data.error ?? "Unable to save response"); setSaving(false); }
  async function remove(id: string) { const response = await fetch(`/api/admin/canned-responses/${id}`, { method: "DELETE" }); if (response.ok) setResponses((current) => current.filter((item) => item.id !== id)); else setError("Unable to delete response"); }

  return <div className="mx-auto max-w-4xl"><Link href="/admin" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500"><ArrowLeft className="size-4" /> Back to dashboard</Link><div className="mb-8"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Administration</p><h1 className="text-3xl font-bold text-slate-950">Canned responses</h1><p className="mt-2 text-sm text-slate-500">Create reusable reply templates for your support team.</p></div><form onSubmit={submit} className="mb-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><input data-testid="canned-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Response title" className="h-11 w-full rounded-xl border border-slate-200 px-3.5 text-sm outline-none focus:border-indigo-500" /><textarea data-testid="canned-body" value={body} onChange={(event) => setBody(event.target.value)} rows={5} placeholder="Response body" className="w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-indigo-500" /><div className="flex justify-between">{error ? <p className="text-sm text-red-600">{error}</p> : <span />}<button data-testid="canned-submit" disabled={saving} className="h-10 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white disabled:opacity-50">Add response</button></div></form><div className="space-y-3">{responses.map((item) => <div key={item.id} data-testid="canned-row" className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="min-w-0 flex-1"><h2 className="font-semibold text-slate-900">{item.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-500">{item.body}</p></div><button onClick={() => remove(item.id)} className="rounded-lg p-2 text-red-500 hover:bg-red-50"><Trash2 className="size-4" /></button></div>)}</div></div>;
}
