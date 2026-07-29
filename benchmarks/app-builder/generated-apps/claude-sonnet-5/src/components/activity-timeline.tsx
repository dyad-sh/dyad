"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ContactActivity } from "@/lib/types";

const TYPE_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  stage_change: "Stage change",
  note: "Note",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleString();
}

export function ActivityTimeline({
  contactId,
  canAddNotes,
}: {
  contactId: string;
  canAddNotes: boolean;
}) {
  const [activities, setActivities] = useState<ContactActivity[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const load = () => {
    fetch(`/api/contacts/${contactId}/activities`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setActivities)
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const handleAddNote = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: note }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to add note");
        return;
      }
      setNote("");
      load();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {canAddNotes && (
        <div className="space-y-2">
          <Textarea
            data-testid="activity-note-input"
            placeholder="Add a note..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            size="sm"
            data-testid="activity-note-submit"
            onClick={handleAddNote}
            disabled={isSubmitting || !note.trim()}
          >
            {isSubmitting ? "Adding..." : "Add note"}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      {!isLoading && activities.length === 0 ? (
        <p data-testid="activity-empty" className="text-sm text-slate-500">
          No activity yet.
        </p>
      ) : (
        <ul data-testid="activity-timeline" className="space-y-3">
          {activities.map((activity) => (
            <li
              key={activity.id}
              data-testid="activity-item"
              className="rounded-md border border-slate-200 bg-white p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <span
                  data-testid="activity-item-type"
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                >
                  {TYPE_LABELS[activity.type] ?? activity.type}
                </span>
                <span data-testid="activity-item-time" className="text-xs text-slate-400">
                  {formatTime(activity.createdAt)}
                </span>
              </div>
              <p data-testid="activity-item-body" className="mt-2 text-slate-900">
                {activity.body}
              </p>
              <p data-testid="activity-item-actor" className="mt-1 text-xs text-slate-500">
                {activity.actorEmail ?? "Unknown"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
