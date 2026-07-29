"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Activity } from "@/lib/types";

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ActivityTimeline({
  contactId,
  activities,
  canAddNote,
}: {
  contactId: string;
  activities: Activity[];
  canAddNote: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!note.trim()) {
      setError("Note is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: note.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not add this note.");
        return;
      }
      setNote("");
      router.refresh();
    } catch {
      setError("Could not add this note.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
        Activity
      </h2>

      {canAddNote ? (
        <form
          onSubmit={addNote}
          noValidate
          className="space-y-2 rounded-xl border border-slate-200 bg-white p-4"
        >
          <textarea
            data-testid="activity-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Add a note…"
            aria-label="Add a note"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
          {error ? (
            <p
              data-testid="activity-note-error"
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            data-testid="activity-note-submit"
            disabled={saving}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "Adding…" : "Add note"}
          </button>
        </form>
      ) : null}

      <div
        data-testid="activity-timeline"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        {activities.length === 0 ? (
          <p
            data-testid="activity-empty"
            className="px-4 py-8 text-center text-sm text-slate-500"
          >
            No activity yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {activities.map((a) => (
              <li
                key={a.id}
                data-testid="activity-item"
                className="space-y-1 px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    data-testid="activity-item-type"
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-600"
                  >
                    {a.type}
                  </span>
                  <span
                    data-testid="activity-item-time"
                    className="ml-auto text-xs text-slate-400"
                  >
                    {formatTime(a.created_at)}
                  </span>
                </div>
                <p
                  data-testid="activity-item-body"
                  className="text-sm text-slate-900"
                >
                  {a.body}
                </p>
                <p
                  data-testid="activity-item-actor"
                  className="text-xs text-slate-500"
                >
                  {a.actor_email}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
