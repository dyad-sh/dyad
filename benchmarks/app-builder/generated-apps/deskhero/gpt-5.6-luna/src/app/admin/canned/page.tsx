"use client";

import { FormEvent, useEffect, useState } from "react";

type Canned = { id: string; title: string; body: string };

export default function CannedResponsesPage() {
  const [responses, setResponses] = useState<Canned[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/canned-responses").then((response) => response.json()).then(setResponses); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch("/api/admin/canned-responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: form.get("title"), body: form.get("body") }) }); const data = await response.json(); if (!response.ok) { setError(data.error); return; } setResponses((current) => [...current, data]); event.currentTarget.reset(); }
  async function remove(id: string) { const response = await fetch(`/api/admin/canned-responses/${id}`, { method: "DELETE" }); if (response.ok) setResponses((current) => current.filter((item) => item.id !== id)); }
  return <main className="mx-auto max-w-5xl px-6 py-12"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-600">Administration</p><h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">Canned responses</h1><p className="mt-2 text-slate-500">Give agents a consistent starting point for common replies.</p><form onSubmit={submit} className="mt-8 grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><input data-testid="canned-title" name="title" placeholder="Response title" className="rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-cyan-500" /><textarea data-testid="canned-body" name="body" rows={4} placeholder="Response text" className="rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-cyan-500" />{error && <p className="text-sm text-rose-600">{error}</p>}<button data-testid="canned-submit" className="w-fit rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-cyan-700">Add response</button></form><div className="mt-8 space-y-3">{responses.map((item) => <div data-testid="canned-row" key={item.id} className="flex items-start justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><h2 className="font-bold text-slate-900">{item.title}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{item.body}</p></div><button onClick={() => remove(item.id)} className="text-sm font-semibold text-rose-600">Delete</button></div>)}</div></main>;
}
