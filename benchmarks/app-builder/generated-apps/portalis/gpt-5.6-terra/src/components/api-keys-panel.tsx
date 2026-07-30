"use client";

import { FormEvent, useState } from "react";

type Key = { id: string; name: string; prefix: string; status: string };

export function ApiKeysPanel({ orgId, initialKeys }: { orgId: string; initialKeys: Key[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [plaintext, setPlaintext] = useState("");
  const [error, setError] = useState("");
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const name = new FormData(event.currentTarget).get("name");
    const response = await fetch(`/api/orgs/${orgId}/api-keys`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Unable to create key."); return; }
    setPlaintext(data.key); setKeys([{ id: data.id, name: data.name, prefix: data.prefix, status: "active" }, ...keys]);
    event.currentTarget.reset();
  }
  async function revoke(keyId: string) {
    setError(""); const response = await fetch(`/api/orgs/${orgId}/api-keys/${keyId}`, { method: "DELETE" });
    if (!response.ok) { setError((await response.json()).error ?? "Unable to revoke key."); return; }
    setKeys(keys.map((key) => key.id === keyId ? { ...key, status: "revoked" } : key));
  }
  return <section className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div><h2 className="text-lg font-semibold">API keys</h2><p className="mt-1 text-sm text-slate-500">Keys grant read-only access to this organization’s projects.</p></div><form onSubmit={create} className="flex flex-wrap gap-3"><input data-testid="apikey-name-input" name="name" required placeholder="Production integration" className="min-w-56 flex-1 rounded-lg border border-slate-200 px-3 py-2.5"/><button data-testid="apikey-create-submit" className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-medium text-white">Create key</button></form>{plaintext && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-medium text-amber-900">Copy this key now — it will not be shown again.</p><code data-testid="apikey-plaintext" className="mt-2 block break-all text-sm text-amber-950">{plaintext}</code></div>}{error && <p className="text-sm text-red-700">{error}</p>}<div className="overflow-x-auto"><table data-testid="apikeys-table" className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-3">Name</th><th className="py-3">Prefix</th><th className="py-3">Status</th><th /></tr></thead><tbody>{keys.map((key) => <tr key={key.id} data-testid="apikey-row" data-key-id={key.id} className="border-t border-slate-100"><td data-testid="apikey-name" className="py-3">{key.name}</td><td data-testid="apikey-prefix" className="py-3 font-mono text-xs">{key.prefix}</td><td data-testid="apikey-status" className="py-3">{key.status}</td><td className="py-3 text-right">{key.status === "active" && <button data-testid="apikey-revoke" onClick={() => revoke(key.id)} className="text-xs font-medium text-red-700">Revoke</button>}</td></tr>)}</tbody></table></div></section>;
}
