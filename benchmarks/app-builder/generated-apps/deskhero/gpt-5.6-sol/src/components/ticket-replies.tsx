'use client';

import { useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";

import type { CannedResponse, TicketReply } from "@/lib/tickets";

export function TicketReplies({ ticketId, cannedEnabled }: { ticketId: string; cannedEnabled: boolean }) {
  const [replies, setReplies] = useState<TicketReply[]>([]);
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/tickets/${ticketId}/replies`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to load replies");
      setReplies(data);
    }).catch((reason: Error) => setError(reason.message));
    if (cannedEnabled) fetch("/api/canned-responses").then(async (response) => response.ok && setCanned(await response.json()));
  }, [ticketId, cannedEnabled]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch(`/api/tickets/${ticketId}/replies`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
    const data = await response.json();
    if (response.ok) { setReplies((current) => [...current, data]); setContent(""); }
    else setError(data.error ?? "Unable to send reply");
    setSaving(false);
  }

  return <section className="border-t border-slate-100 p-6 sm:p-8"><div className="mb-5 flex items-center gap-2"><MessageCircle className="size-5 text-indigo-600" /><h2 className="font-semibold text-slate-900">Conversation</h2></div><div className="mb-6 space-y-3">{replies.map((reply) => <div key={reply.id} data-testid="reply-item" className="rounded-xl border border-slate-100 bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><strong className="text-xs text-slate-700">{reply.author_name}</strong><span className="text-[11px] text-slate-400">{new Date(reply.created_at).toLocaleString()}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{reply.content}</p></div>)}{!replies.length && <p className="text-sm text-slate-400">No replies yet.</p>}</div>
    <form onSubmit={submit} className="space-y-3">{cannedEnabled && <select data-testid="canned-select" defaultValue="" onChange={(event) => { const selected = canned.find((item) => item.id === event.target.value); if (selected) setContent(selected.body); }} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500"><option value="">Choose a canned response…</option>{canned.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}<textarea data-testid="reply-input" value={content} onChange={(event) => setContent(event.target.value)} rows={4} placeholder="Write a public reply…" className="w-full resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /><div className="flex items-center justify-between gap-3">{error ? <p className="text-sm text-red-600">{error}</p> : <span />}<button data-testid="reply-submit" disabled={saving || !content.trim()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><Send className="size-4" /> Send reply</button></div></form>
  </section>;
}
