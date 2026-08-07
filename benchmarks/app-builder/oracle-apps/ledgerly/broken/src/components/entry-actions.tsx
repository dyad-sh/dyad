"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const PRIMARY =
  "rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-slate-800";
const SECONDARY =
  "rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100";
const DANGER =
  "rounded-lg border border-red-300 px-3.5 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50";

/**
 * The controls a single entry offers. A posted entry gets neither the edit nor
 * the delete control — but the server refuses those writes regardless, so this
 * is presentation, never the enforcement.
 */
export function EntryActions({
  entryId,
  status,
}: {
  entryId: string;
  status: "draft" | "posted";
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);

  async function call(path: string, method = "POST", to?: string) {
    setError("");
    const response = await fetch(path, { method, keepalive: true });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body?.error ?? "That change could not be made.");
      return;
    }
    if (to) {
      router.push(to);
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" ? (
          <>
            <button
              type="button"
              data-testid="entry-post-button"
              onClick={() => call(`/api/entries/${entryId}/post`)}
              className={PRIMARY}
            >
              Post entry
            </button>
            <Link
              href={`/journal/${entryId}/edit`}
              data-testid="entry-edit-button"
              className={SECONDARY}
            >
              Edit
            </Link>
            <button
              type="button"
              data-testid="entry-delete-button"
              onClick={() => setArmed(true)}
              className={DANGER}
            >
              Delete
            </button>
            {armed ? (
              <button
                type="button"
                data-testid="entry-delete-confirm"
                onClick={() =>
                  call(`/api/entries/${entryId}`, "DELETE", "/journal")
                }
                className={DANGER}
              >
                Confirm delete
              </button>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            data-testid="entry-reverse-button"
            onClick={() => call(`/api/entries/${entryId}/reverse`)}
            className={PRIMARY}
          >
            Reverse entry
          </button>
        )}
      </div>

      {error ? (
        <p
          data-testid="entry-error"
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      ) : (
        <p data-testid="entry-error" className="hidden" />
      )}
    </div>
  );
}
