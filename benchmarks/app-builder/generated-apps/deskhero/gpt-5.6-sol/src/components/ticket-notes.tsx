'use client';

import { useEffect, useState } from "react";
import { MessageSquareText, Send } from "lucide-react";

import type { TicketNote } from "@/lib/tickets";

export function TicketNotes({ ticketId }: { ticketId: string }) {
  const [notes, setNotes] = useState<TicketNote[]>([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/tickets/${ticketId}/notes`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to load notes");
      setNotes(data);
    }).catch((reason: Error) => setError(reason.message));
  }, [ticketId]);

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    const response = await fetch(`/api/tickets/${ticketId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const data = await response.json();
    if (response.ok) { setNotes((current) => [...current, data]); setContent(""); }
    else setError(data.error ?? "Unable to add note");
    setSaving(false);
  }

  return (
    <section data-testid="notes-section" className="border-t border-slate-100 p-6 sm:p-8">
      <div className="mb-5 flex items-center gap-2"><MessageSquareText className="size-5 text-indigo-600" /><h2 className="font-semibold text-slate-900">Internal notes</h2><span className="text-xs text-slate-400">Agents and admins only</span></div>
      <div className="mb-5 space-y-3">
        {notes.map((note) => <div key={note.id} data-testid="note-item" className="rounded-xl bg-amber-50/70 p-4"><div className="flex items-center justify-between gap-3"><strong className="text-xs text-amber-900">{note.author_name}</strong><span className="text-[11px] text-amber-700/60">{new Date(note.created_at).toLocaleString()}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.content}</p></div>)}
        {!notes.length && <p className="text-sm text-slate-400">No internal notes yet.</p>}
      </div>
      <form onSubmit={addNote} className="flex items-end gap-3">
        <div className="flex-1"><label htmlFor="note-input" className="sr-only">Internal note</label><textarea id="note-input" data-testid="note-input" value={content} onChange={(event) => setContent(event.target.value)} rows={3} placeholder="Add context for the support team…" className="w-full resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100" /></div>
        <button data-testid="note-submit" disabled={saving || !content.trim()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><Send className="size-4" /> Add</button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </section>
  );
}
