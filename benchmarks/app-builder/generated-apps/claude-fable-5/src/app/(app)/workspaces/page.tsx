'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';

type Workspace = { id: string; name: string };

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetch('/api/workspaces')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Workspace[]) => setWorkspaces(data))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to create workspace');
      }
      setName('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Workspaces</h1>
        <Button
          data-testid="workspace-create-button"
          onClick={() => setShowForm((v) => !v)}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New workspace
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 max-w-lg space-y-4 rounded-lg border border-slate-200 bg-white p-6"
        >
          <div className="space-y-1.5">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              required
              data-testid="workspace-form-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Sales"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          <Button
            type="submit"
            data-testid="workspace-form-submit"
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {saving ? 'Creating…' : 'Create workspace'}
          </Button>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ul
          data-testid="workspace-list"
          className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          {workspaces.map((workspace) => (
            <li
              key={workspace.id}
              data-testid="workspace-row"
              className="flex items-center gap-4 px-4 py-3"
            >
              <span data-testid="workspace-row-name" className="font-medium text-slate-900">
                {workspace.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
