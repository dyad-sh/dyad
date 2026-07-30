"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { errorMessage } from "@/lib/error-message";

type Canned = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export default function AdminCannedPage() {
  const [items, setItems] = useState<Canned[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/admin/canned-responses", {
      cache: "no-store",
    });
    if (res.status === 401) {
      window.location.href = "/auth/sign-in";
      return;
    }
    if (res.ok) setItems((await res.json()) as Canned[]);
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim() || !body.trim()) {
      setError("Title and body are required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/canned-responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(errorMessage(payload, "Could not save the canned response."));
        return;
      }
      setTitle("");
      setBody("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setError(null);
    const res = await fetch(`/api/admin/canned-responses/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError("Could not delete the canned response.");
      return;
    }
    await load();
  }

  return (
    <div>
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">
        Canned responses
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Reusable replies agents can drop into a ticket conversation.
      </p>

      <form
        onSubmit={onSubmit}
        noValidate
        className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="space-y-1.5">
          <label htmlFor="canned-title" className="text-sm font-medium text-slate-700">
            Title
          </label>
          <input
            id="canned-title"
            data-testid="canned-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Password reset instructions"
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="canned-body" className="text-sm font-medium text-slate-700">
            Body
          </label>
          <textarea
            id="canned-body"
            data-testid="canned-body"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hi there, please follow these steps…"
            className={inputClass}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          data-testid="canned-submit"
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Add canned response"}
        </button>
      </form>

      <ul className="mt-6 space-y-3">
        {items.length === 0 ? (
          <li className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
            No canned responses yet.
          </li>
        ) : (
          items.map((item) => (
            <li
              key={item.id}
              data-testid="canned-row"
              className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">
                  {item.title}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                  {item.body}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Delete ${item.title}`}
                onClick={() => onDelete(item.id)}
                className="shrink-0 rounded-lg border border-red-200 bg-red-50 p-2 text-red-700 transition hover:bg-red-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
