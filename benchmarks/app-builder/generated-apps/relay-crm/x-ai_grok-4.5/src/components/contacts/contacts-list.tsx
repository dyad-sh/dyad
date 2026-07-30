"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import type { Contact } from "@/lib/types";

export function ContactsList({ contacts }: { contacts: Contact[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((contact) => {
      const name = (contact.name ?? "").toLowerCase();
      const email = (contact.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [contacts, query]);

  return (
    <div className="space-y-4">
      <Input
        data-testid="contacts-search"
        placeholder="Search by name or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-md"
      />

      <div data-testid="contacts-list">
        {filtered.length === 0 ? (
          <p
            data-testid="contacts-empty"
            className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500"
          >
            {contacts.length === 0
              ? "No contacts yet. Create your first contact to get started."
              : "No contacts match your search."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {filtered.map((contact) => (
              <li
                key={contact.id}
                data-testid="contact-row"
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span
                      data-testid="contact-row-name"
                      className="font-medium text-slate-900"
                    >
                      {contact.name}
                    </span>
                    <span
                      data-testid="contact-row-email"
                      className="truncate text-sm text-slate-500"
                    >
                      {contact.email || "—"}
                    </span>
                  </div>
                  <p
                    data-testid="contact-row-company"
                    className="text-sm text-slate-500"
                  >
                    {contact.company_name || "No company"}
                  </p>
                </div>
                <Link
                  href={`/contacts/${contact.id}`}
                  data-testid="contact-row-link"
                  className="text-sm font-medium text-slate-900 underline-offset-4 hover:underline"
                >
                  View
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
