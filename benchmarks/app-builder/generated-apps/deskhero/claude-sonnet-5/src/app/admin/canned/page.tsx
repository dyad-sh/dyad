"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CannedResponse } from "@/types/ticket";

export default function AdminCannedResponsesPage() {
  const [responses, setResponses] = useState<CannedResponse[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  function loadResponses() {
    fetch("/api/canned-responses")
      .then((res) => (res.ok ? res.json() : []))
      .then(setResponses);
  }

  useEffect(() => {
    loadResponses();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !body.trim()) {
      setError("Title and body are required.");
      return;
    }

    const res = await fetch("/api/admin/canned-responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), body: body.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to create canned response.");
      return;
    }
    setTitle("");
    setBody("");
    loadResponses();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/admin/canned-responses/${id}`, { method: "DELETE" });
    loadResponses();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">
        Canned Responses
      </h1>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="space-y-2">
          <Label htmlFor="canned-title">Title</Label>
          <Input
            id="canned-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="canned-title"
            placeholder="e.g. Password reset instructions"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="canned-body">Body</Label>
          <Textarea
            id="canned-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            data-testid="canned-body"
            placeholder="The reply text..."
            rows={4}
          />
        </div>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" data-testid="canned-submit">
          Add Canned Response
        </Button>
      </form>

      <div className="space-y-3">
        {responses === null ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : responses.length === 0 ? (
          <p className="text-sm text-slate-500">No canned responses yet.</p>
        ) : (
          responses.map((response) => (
            <div
              key={response.id}
              data-testid="canned-row"
              className="flex items-start justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <p className="font-medium text-slate-900">{response.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                  {response.body}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDelete(response.id)}
              >
                Delete
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
