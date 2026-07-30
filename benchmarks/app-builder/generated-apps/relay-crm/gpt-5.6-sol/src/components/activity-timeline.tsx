'use client';

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Activity = { id: string; type: string; body: string; actor: string; createdAt: string };

const typeLabels: Record<string, string> = { created: "Created", updated: "Updated", deal_stage: "Deal stage", note: "Note" };

export function ActivityTimeline({ contactId, initialActivities, canAddNotes }: { contactId: string; initialActivities: Activity[]; canAddNotes: boolean }) {
  const [activities, setActivities] = useState(initialActivities);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const addNote = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    const response = await fetch(`/api/contacts/${contactId}/activities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: note }) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) { setError(data.error || "Unable to add note"); return; }
    setActivities((current) => [data, ...current]); setNote("");
  };
  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-950">Activity</h2>{canAddNotes && <form onSubmit={addNote} className="mt-4"><Textarea placeholder="Add a note…" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} required data-testid="activity-note-input" /><div className="mt-3 flex items-center justify-between gap-3"><p className="text-sm text-red-600">{error}</p><Button type="submit" size="sm" disabled={saving} data-testid="activity-note-submit">{saving ? "Adding…" : "Add note"}</Button></div></form>}<div className="mt-6 space-y-4" data-testid="activity-timeline">{activities.map((activity) => <article key={activity.id} className="relative border-l-2 border-indigo-100 pl-5" data-testid="activity-item"><span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-indigo-500" /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-wider text-indigo-600" data-testid="activity-item-type">{typeLabels[activity.type] || activity.type}</span><time className="text-xs text-slate-400" dateTime={activity.createdAt} data-testid="activity-item-time">{new Date(activity.createdAt).toLocaleString()}</time></div><p className="mt-1 text-sm text-slate-800" data-testid="activity-item-body">{activity.body}</p><p className="mt-1 text-xs text-slate-500" data-testid="activity-item-actor">{activity.actor}</p></article>)}{!activities.length && <p className="py-8 text-center text-sm text-slate-500" data-testid="activity-empty">No activity yet.</p>}</div></section>;
}
