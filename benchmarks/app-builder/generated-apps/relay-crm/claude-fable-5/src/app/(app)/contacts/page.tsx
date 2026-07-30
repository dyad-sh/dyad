'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMe } from '@/hooks/use-me';
import { Download, Plus } from 'lucide-react';

type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  company_id: string | null;
  company_name: string | null;
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { canWrite } = useMe();

  useEffect(() => {
    fetch('/api/contacts')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Contact[]) => setContacts(data))
      .finally(() => setLoading(false));
  }, []);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.email.toLowerCase().includes(query),
      )
    : contacts;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Contacts</h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <a data-testid="export-contacts-button" href="/api/export/contacts.csv" download>
              <Download className="mr-1.5 h-4 w-4" />
              Export CSV
            </a>
          </Button>
          {canWrite && (
            <Button asChild data-testid="contact-new-button" className="bg-indigo-600 hover:bg-indigo-700">
              <Link href="/contacts/new">
                <Plus className="mr-1.5 h-4 w-4" />
                New contact
              </Link>
            </Button>
          )}
        </div>
      </div>
      <Input
        data-testid="contacts-search"
        placeholder="Search by name or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 max-w-sm bg-white"
      />
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div
          data-testid="contacts-empty"
          className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500"
        >
          {contacts.length === 0
            ? 'No contacts yet. Create your first contact to get started.'
            : 'No contacts match your search.'}
        </div>
      ) : (
        <ul
          data-testid="contacts-list"
          className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          {filtered.map((contact) => (
            <li
              key={contact.id}
              data-testid="contact-row"
              className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <p data-testid="contact-row-name" className="font-medium text-slate-900">
                  {contact.name}
                </p>
                <p data-testid="contact-row-email" className="truncate text-sm text-slate-500">
                  {contact.email}
                </p>
              </div>
              <span data-testid="contact-row-company" className="text-sm text-slate-500">
                {contact.company_name ?? ''}
              </span>
              <Link
                href={`/contacts/${contact.id}`}
                data-testid="contact-row-link"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                View
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
