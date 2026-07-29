"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Company } from "@/lib/types";

export function CompanyDetailClient({
  company,
  canWrite = true,
}: {
  company: Company;
  canWrite?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(company.name);
  const [domain, setDomain] = useState(company.domain ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`/api/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          domain: domain.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Failed to update company",
        );
        setLoading(false);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Failed to update company");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/companies/${company.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setLoading(false);
        return;
      }
      router.push("/companies");
      router.refresh();
    } catch {
      setLoading(false);
    }
  };

  if (editing && canWrite) {
      return (
        <form onSubmit={handleSave} className="max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="space-y-2">
          <Label htmlFor="company-edit-name">Name</Label>
          <Input
            id="company-edit-name"
            data-testid="company-form-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company-edit-domain">Domain</Label>
          <Input
            id="company-edit-domain"
            data-testid="company-form-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
        </div>
        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" data-testid="company-form-submit" disabled={loading}>
            {loading ? "Saving…" : "Save changes"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setEditing(false);
              setName(company.name);
              setDomain(company.domain ?? "");
              setError("");
            }}
            disabled={loading}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm text-slate-500">Company</p>
        <h1
          data-testid="company-detail-name"
          className="mt-1 text-2xl font-semibold tracking-tight"
        >
          {company.name}
        </h1>
        <p
          data-testid="company-detail-domain"
          className="mt-2 text-sm text-slate-600"
        >
          {company.domain || "No domain"}
        </p>
      </div>
      {canWrite ? (
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                {!confirmingDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={loading}
                  >
                    Delete
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={loading}
                    >
                      {loading ? "Deleting…" : "Confirm delete"}
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        );
      }
