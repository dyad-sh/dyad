'use client';

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Contact = { id: string; name: string; email: string; companyName: string | null };

export function ContactsList({ contacts }: { contacts: Contact[] }) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((contact) => !query || contact.name.toLowerCase().includes(query) || contact.email.toLowerCase().includes(query));
  }, [contacts, search]);

  return (
    <>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="h-11 bg-white pl-9" placeholder="Search by name or email…" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="contacts-search" />
      </div>
      {visible.length ? (
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="contacts-list">
          <div className="hidden grid-cols-[1.2fr_1.3fr_1fr_40px] gap-4 border-b bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 sm:grid"><span>Name</span><span>Email</span><span>Company</span><span /></div>
          {visible.map((contact) => (
            <div key={contact.id} className="grid gap-1 border-b border-slate-100 px-5 py-4 last:border-0 sm:grid-cols-[1.2fr_1.3fr_1fr_40px] sm:items-center sm:gap-4" data-testid="contact-row">
              <span className="font-medium text-slate-950" data-testid="contact-row-name">{contact.name}</span>
              <span className="text-sm text-slate-600" data-testid="contact-row-email">{contact.email || "—"}</span>
              <span className="text-sm text-slate-600" data-testid="contact-row-company">{contact.companyName || "—"}</span>
              <Link href={`/contacts/${contact.id}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-700" data-testid="contact-row-link" aria-label={`View ${contact.name}`}>View</Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center" data-testid="contacts-empty">
          <p className="font-medium text-slate-900">No contacts found</p><p className="mt-1 text-sm text-slate-500">{search ? "Try a different search." : "Create your first contact to get started."}</p>
        </div>
      )}
    </>
  );
}
