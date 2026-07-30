"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type { Workspace } from "@/lib/types";

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = () => {
    fetch("/api/workspaces")
      .then((res) => (res.ok ? res.json() : []))
      .then(setWorkspaces);
  };

  useEffect(() => {
    load();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to create workspace");
        return;
      }
      setName("");
      setShowForm(false);
      load();
      window.location.reload();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Workspaces</h1>
        <Button data-testid="workspace-create-button" onClick={() => setShowForm((v) => !v)}>
          New workspace
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="workspace-form-name">Workspace name</Label>
                <Input
                  id="workspace-form-name"
                  data-testid="workspace-form-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" data-testid="workspace-form-submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create workspace"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div data-testid="workspace-list" className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((workspace) => (
              <tr key={workspace.id} data-testid="workspace-row" className="border-b border-slate-100 last:border-0">
                <td data-testid="workspace-row-name" className="px-4 py-3 text-slate-900">
                  {workspace.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
