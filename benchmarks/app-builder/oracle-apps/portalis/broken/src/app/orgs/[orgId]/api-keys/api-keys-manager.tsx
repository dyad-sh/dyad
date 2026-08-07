"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiKeyRow } from "@/lib/api-keys";

export function ApiKeysManager({
  orgId,
  keys,
}: {
  orgId: string;
  keys: ApiKeyRow[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPlaintext(null);
    setPending(true);
    const res = await fetch(`/api/orgs/${orgId}/api-keys`, {
      // Survives the page navigating away mid-submit.
      keepalive: true,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setPending(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not create the key.");
      return;
    }
    const body = (await res.json()) as { key: string };
    setPlaintext(body.key);
    setName("");
    router.refresh();
  }

  async function revoke(keyId: string) {
    setError(null);
    const res = await fetch(`/api/orgs/${orgId}/api-keys/${keyId}`, {
      // Survives the page navigating away mid-submit.
      keepalive: true,
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not revoke the key.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Create an API key
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Read-only keys scoped to this organization. The secret is shown once
          and stored only as a hash.
        </p>
        <form
          onSubmit={create}
          className="mt-5 flex flex-wrap items-end gap-3"
          noValidate
        >
          <div className="min-w-[16rem] flex-1 space-y-1.5">
            <label
              htmlFor="apikey-name"
              className="block text-sm font-medium text-slate-700"
            >
              Key name
            </label>
            <input
              id="apikey-name"
              data-testid="apikey-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CI pipeline"
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <button
            type="submit"
            data-testid="apikey-create-submit"
            disabled={pending}
            className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? "Creating…" : "Create key"}
          </button>
        </form>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {plaintext && (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-medium text-emerald-800">
              Copy this secret now — it will never be shown again.
            </p>
            <code
              data-testid="apikey-plaintext"
              className="mt-2 block break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-slate-800"
            >
              {plaintext}
            </code>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-lg font-semibold text-slate-900">Keys</h2>
          <p className="mt-1 text-sm text-slate-500">
            Only the display prefix is retained.
          </p>
        </div>
        {keys.length === 0 ? (
          <p className="px-6 py-8 text-sm text-slate-500">No API keys yet.</p>
        ) : (
          <table
            data-testid="apikeys-table"
            className="w-full text-left text-sm"
          >
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Prefix</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr
                  key={key.id}
                  data-testid="apikey-row"
                  data-key-id={key.id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-6 py-4">
                    <span
                      data-testid="apikey-name"
                      className="font-medium text-slate-900"
                    >
                      {key.name}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      data-testid="apikey-prefix"
                      className="font-mono text-xs text-slate-600"
                    >
                      {key.prefix}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      data-testid="apikey-status"
                      className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${
                        key.status === "active"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {key.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {key.status === "active" && (
                      <button
                        type="button"
                        data-testid="apikey-revoke"
                        onClick={() => revoke(key.id)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
