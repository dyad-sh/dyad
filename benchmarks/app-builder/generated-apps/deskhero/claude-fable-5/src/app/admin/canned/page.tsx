"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import type { CannedResponse } from "@/lib/tickets";
import { Trash2 } from "lucide-react";

export default function AdminCannedPage() {
  const [responses, setResponses] = useState<CannedResponse[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/canned-responses")
      .then((res) => (res.ok ? res.json() : []))
      .then(setResponses)
      .catch(() => setResponses([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !body.trim()) {
      setError("Title and body are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/canned-responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Could not create canned response.");
        return;
      }
      const created = await res.json();
      setResponses((curr) =>
        [...(curr ?? []), created].sort((a, b) => (a.title < b.title ? -1 : 1)),
      );
      setTitle("");
      setBody("");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/admin/canned-responses/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setResponses((curr) => curr?.filter((r) => r.id !== id) ?? curr);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Canned responses
        </h1>
        <p className="text-sm text-slate-500">
          Reusable reply templates for agents and admins
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="mb-8 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="space-y-2">
          <Label htmlFor="canned-title">Title</Label>
          <Input
            id="canned-title"
            data-testid="canned-title"
            placeholder="e.g. Password reset steps"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="canned-body">Body</Label>
          <Textarea
            id="canned-body"
            data-testid="canned-body"
            placeholder="The reply text that will fill the reply box…"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button
          type="submit"
          data-testid="canned-submit"
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700"
        >
          {saving ? "Saving…" : "Add canned response"}
        </Button>
      </form>

      {responses === null ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : responses.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white py-10 text-center text-sm text-slate-500">
          No canned responses yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {responses.map((response) => (
            <li
              key={response.id}
              data-testid="canned-row"
              className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{response.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                  {response.body}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDelete(response.id)}
                className="shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
