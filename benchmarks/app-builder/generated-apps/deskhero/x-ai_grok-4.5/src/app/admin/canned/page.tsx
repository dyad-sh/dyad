"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CannedResponse } from "@/lib/tickets";

export default function AdminCannedPage() {
  const [items, setItems] = useState<CannedResponse[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/canned-responses");
    if (!response.ok) {
      if (response.status === 403) {
        window.location.href = "/account-deactivated";
        return;
      }
      throw new Error("Failed to load canned responses");
    }
    setItems((await response.json()) as CannedResponse[]);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load responses",
          );
          setItems([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/canned-responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to create response");
      }
      setTitle("");
      setBody("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create response");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      const response = await fetch(`/api/admin/canned-responses/${id}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        throw new Error("Failed to delete response");
      }
      setItems((prev) => (prev ?? []).filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete response");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Canned responses
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Create reusable reply templates for agents and admins.
        </p>
      </div>

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">New template</CardTitle>
          <CardDescription>
            Templates fill the reply box and can still be edited before send.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="canned-title">Title</Label>
              <Input
                id="canned-title"
                data-testid="canned-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Greeting"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="canned-body">Body</Label>
              <Textarea
                id="canned-body"
                data-testid="canned-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Thanks for reaching out..."
                rows={4}
                disabled={pending}
              />
            </div>
            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <Button type="submit" data-testid="canned-submit" disabled={pending}>
              {pending ? "Saving..." : "Add canned response"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Existing templates</CardTitle>
        </CardHeader>
        <CardContent>
          {items === null ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-500">No canned responses yet.</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {items.map((item) => (
                <li
                  key={item.id}
                  data-testid="canned-row"
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-slate-900">{item.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                      {item.body}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDelete(item.id)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
