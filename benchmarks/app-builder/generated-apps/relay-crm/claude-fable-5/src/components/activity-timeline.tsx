'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

type Activity = {
  id: string;
  type: string;
  body: string;
  actorEmail: string;
  createdAt: string;
};

export function ActivityTimeline({
  contactId,
  canWrite,
}: {
  contactId: string;
  canWrite: boolean;
}) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/contacts/${contactId}/activities`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Activity[]) => setActivities(data))
      .finally(() => setLoading(false));
  }, [contactId]);

  useEffect(load, [load]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: note }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to add note');
      }
      setNote('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8 max-w-lg">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">Activity</h2>

      {canWrite && (
        <form
          onSubmit={handleAddNote}
          className="mb-4 rounded-lg border border-slate-200 bg-white p-4"
        >
          <Textarea
            data-testid="activity-note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
            rows={2}
          />
          {error && (
            <p className="mt-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            data-testid="activity-note-submit"
            disabled={saving || !note.trim()}
            className="mt-2 bg-indigo-600 hover:bg-indigo-700"
          >
            {saving ? 'Adding…' : 'Add note'}
          </Button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : activities.length === 0 ? (
        <div
          data-testid="activity-empty"
          className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500"
        >
          No activity yet.
        </div>
      ) : (
        <ul
          data-testid="activity-timeline"
          className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          {activities.map((activity) => (
            <li key={activity.id} data-testid="activity-item" className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <Badge
                  data-testid="activity-item-type"
                  variant={activity.type === 'note' ? 'default' : 'secondary'}
                  className={activity.type === 'note' ? 'bg-indigo-600' : ''}
                >
                  {activity.type}
                </Badge>
                <span
                  data-testid="activity-item-time"
                  className="text-xs text-slate-400"
                >
                  {new Date(activity.createdAt).toLocaleString()}
                </span>
              </div>
              <p data-testid="activity-item-body" className="mt-1.5 text-sm text-slate-900">
                {activity.body}
              </p>
              <p data-testid="activity-item-actor" className="mt-0.5 text-xs text-slate-500">
                {activity.actorEmail}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
