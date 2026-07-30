"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ContactActivity } from "@/lib/types";

function formatTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case "note":
      return "Note";
    case "contact_created":
      return "Created";
    case "contact_updated":
      return "Updated";
    case "deal_stage_changed":
      return "Deal stage";
    default:
      return type;
  }
}

export function ActivityTimeline({
  contactId,
  initialActivities,
  canAddNote,
}: {
  contactId: string;
  initialActivities: ContactActivity[];
  canAddNote: boolean;
}) {
  const router = useRouter();
  const [activities, setActivities] = useState(initialActivities);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submitNote = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`/api/contacts/${contactId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: note }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to add note");
        return;
      }
      setNote("");
      setActivities((current) => [data as ContactActivity, ...current]);
      router.refresh();
    } catch {
      setError("Failed to add note");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium tracking-tight">Activity</h2>

      {canAddNote ? (
        <form onSubmit={submitNote} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <textarea
            data-testid="activity-note-input"
            className="min-h-[88px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Add a note…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
          />
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" data-testid="activity-note-submit" disabled={loading}>
            {loading ? "Saving…" : "Add note"}
          </Button>
        </form>
      ) : null}

      <div data-testid="activity-timeline">
        {activities.length === 0 ? (
          <p
            data-testid="activity-empty"
            className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500"
          >
            No activity yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {activities.map((item) => (
              <li
                key={item.id}
                data-testid="activity-item"
                className="rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    data-testid="activity-item-type"
                    className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                  >
                    {typeLabel(item.type)}
                  </span>
                  <span
                    data-testid="activity-item-actor"
                    className="text-xs text-slate-500"
                  >
                    {item.actor_name || item.actor_email || "Someone"}
                  </span>
                  <time
                    data-testid="activity-item-time"
                    className="text-xs text-slate-400"
                    dateTime={item.created_at}
                  >
                    {formatTime(item.created_at)}
                  </time>
                </div>
                <p
                  data-testid="activity-item-body"
                  className="mt-2 text-sm text-slate-800"
                >
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
