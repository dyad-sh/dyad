"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import type { Contact } from "@/lib/types";
import { useMe } from "@/lib/use-me";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const { activeRole } = useMe();
  const canWrite = activeRole === "owner" || activeRole === "member";

  useEffect(() => {
    fetch("/api/contacts")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setContacts(data))
      .finally(() => setIsLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter(
      (contact) =>
        contact.name.toLowerCase().includes(query) ||
        contact.email.toLowerCase().includes(query),
    );
  }, [contacts, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Contacts</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline" data-testid="export-contacts-button">
            <a href="/api/export/contacts.csv" download>
              <Download className="h-4 w-4" />
              Export CSV
            </a>
          </Button>
          {canWrite && (
            <Button asChild data-testid="contact-new-button">
              <Link href="/contacts/new">New contact</Link>
            </Button>
          )}
        </div>
      </div>

      <Input
        data-testid="contacts-search"
        placeholder="Search by name or email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {!isLoading && filtered.length === 0 ? (
        <p
          data-testid="contacts-empty"
          className="rounded-lg border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-500"
        >
          No contacts found.
        </p>
      ) : (
        <div
          data-testid="contacts-list"
          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((contact) => (
                <tr
                  key={contact.id}
                  data-testid="contact-row"
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td data-testid="contact-row-name" className="px-4 py-3 text-slate-900">
                    {contact.name}
                  </td>
                  <td data-testid="contact-row-email" className="px-4 py-3 text-slate-600">
                    {contact.email}
                  </td>
                  <td data-testid="contact-row-company" className="px-4 py-3 text-slate-600">
                    {contact.companyName ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/contacts/${contact.id}`}
                      data-testid="contact-row-link"
                      className="font-medium text-slate-900 underline-offset-4 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
