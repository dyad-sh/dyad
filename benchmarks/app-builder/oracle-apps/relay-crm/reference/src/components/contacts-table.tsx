"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ContactWithCompany } from "@/lib/types";

export function ContactsTable({ contacts }: { contacts: ContactWithCompany[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q),
    );
  }, [contacts, query]);

  return (
    <div className="space-y-4">
      <input
        type="search"
        data-testid="contacts-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email…"
        className="w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
      />

      {/* The empty state REPLACES the list rather than nesting inside it, so
          "the list or the empty state" always names exactly one element. */}
      {filtered.length === 0 ? (
        <p
          data-testid="contacts-empty"
          className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500"
        >
          No contacts found.
        </p>
      ) : (
        <div
          data-testid="contacts-list"
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          <ul className="divide-y divide-slate-100">
            {filtered.map((c) => (
              <li
                key={c.id}
                data-testid="contact-row"
                className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 transition hover:bg-slate-50"
              >
                <span
                  data-testid="contact-row-name"
                  className="min-w-[140px] text-sm font-medium text-slate-900"
                >
                  {c.name}
                </span>
                <span
                  data-testid="contact-row-email"
                  className="min-w-[180px] text-sm text-slate-600"
                >
                  {c.email ?? ""}
                </span>
                <span
                  data-testid="contact-row-company"
                  className="text-sm text-slate-500"
                >
                  {c.company_name ?? ""}
                </span>
                <Link
                  href={`/contacts/${c.id}`}
                  data-testid="contact-row-link"
                  className="ml-auto text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
                >
                  View
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
