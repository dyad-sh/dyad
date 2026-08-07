"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Account } from "@/lib/accounts";
import type { EntryDetail } from "@/lib/entries";
import { centsToDollars, dollarsToCents } from "@/lib/money";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

type Row = { accountId: string; debit: string; credit: string };

const BLANK: Row = { accountId: "", debit: "", credit: "" };

/** A row the bookkeeper simply left alone is ignored, not rejected. */
function isBlank(row: Row): boolean {
  return (
    row.accountId === "" && row.debit.trim() === "" && row.credit.trim() === ""
  );
}

/** Three rows minimum, plus one per line an existing entry already has. */
function initialRows(entry?: EntryDetail): Row[] {
  const rows = (entry?.lines ?? []).map((line) => ({
    accountId: line.accountId,
    debit: line.debitCents > 0 ? centsToDollars(line.debitCents) : "",
    credit: line.creditCents > 0 ? centsToDollars(line.creditCents) : "",
  }));
  while (rows.length < 3) rows.push({ ...BLANK });
  return rows;
}

export function EntryForm({
  accounts,
  entry,
}: {
  accounts: Account[];
  entry?: EntryDetail;
}) {
  const router = useRouter();
  const [date, setDate] = useState(entry?.date ?? "");
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [rows, setRows] = useState<Row[]>(() => initialRows(entry));
  const [error, setError] = useState("");

  function update(index: number, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    let lines;
    try {
      lines = rows.filter((row) => !isBlank(row)).map((row) => ({
        accountId: row.accountId,
        debitCents: row.debit.trim() === "" ? 0 : dollarsToCents(row.debit),
        creditCents: row.credit.trim() === "" ? 0 : dollarsToCents(row.credit),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enter a valid amount.");
      return;
    }

    const response = await fetch(
      entry ? `/api/entries/${entry.id}` : "/api/entries",
      {
        method: entry ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date, memo, lines }),
        keepalive: true,
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(body?.error ?? "That entry could not be saved.");
      return;
    }
    router.push(`/journal/${entry ? entry.id : body.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="grid gap-5 sm:grid-cols-[12rem_1fr]">
        <div className="space-y-1.5">
          <label htmlFor="entry-form-date" className="text-sm font-medium text-slate-700">
            Date
          </label>
          <input
            id="entry-form-date"
            data-testid="entry-form-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={FIELD}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="entry-form-memo" className="text-sm font-medium text-slate-700">
            Memo
          </label>
          <input
            id="entry-form-memo"
            data-testid="entry-form-memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className={FIELD}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="grid grid-cols-[1fr_9rem_9rem] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Account</span>
          <span>Debit</span>
          <span>Credit</span>
        </div>
        {rows.map((row, index) => (
          <div
            key={index}
            data-testid="entry-line-row"
            className="grid grid-cols-[1fr_9rem_9rem] gap-4 border-b border-slate-100 px-4 py-3 last:border-b-0"
          >
            <select
              data-testid="line-account"
              aria-label={`Line ${index + 1} account`}
              value={row.accountId}
              onChange={(e) => update(index, { accountId: e.target.value })}
              className={FIELD}
            >
              <option value="">Select an account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} {account.name}
                </option>
              ))}
            </select>
            <input
              data-testid="line-debit"
              aria-label={`Line ${index + 1} debit`}
              inputMode="decimal"
              value={row.debit}
              onChange={(e) => update(index, { debit: e.target.value })}
              className={FIELD}
            />
            <input
              data-testid="line-credit"
              aria-label={`Line ${index + 1} credit`}
              inputMode="decimal"
              value={row.credit}
              onChange={(e) => update(index, { credit: e.target.value })}
              className={FIELD}
            />
          </div>
        ))}
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

      {/* Never disabled: an unbalanced entry must be able to reach the server
          rule and come back with the reason, not be silently unsubmittable. */}
      <button
        type="submit"
        data-testid="entry-submit"
        className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        {entry ? "Save changes" : "Save entry"}
      </button>
    </form>
  );
}
