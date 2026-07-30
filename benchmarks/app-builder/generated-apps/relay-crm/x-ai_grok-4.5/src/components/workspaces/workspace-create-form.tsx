"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WorkspaceCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to create workspace");
        return;
      }
      setName("");
            setOpen(false);
            window.dispatchEvent(new Event("workspace-changed"));
            router.refresh();
    } catch {
      setError("Failed to create workspace");
    } finally {
      setLoading(false);
    }
  };

  return (
      <div className="space-y-3">
        <Button
          type="button"
          data-testid="workspace-create-button"
          variant={open ? "outline" : "default"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "New workspace"}
        </Button>
        {open ? (
          <form
            onSubmit={onSubmit}
            className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="space-y-2">
              <Label htmlFor="workspace-form-name">Workspace name</Label>
              <Input
                id="workspace-form-name"
                data-testid="workspace-form-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Acme Sales"
              />
            </div>
            {error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            ) : null}
            <Button type="submit" data-testid="workspace-form-submit" disabled={loading}>
              {loading ? "Creating…" : "Create workspace"}
            </Button>
          </form>
        ) : null}
      </div>
    );
  }
