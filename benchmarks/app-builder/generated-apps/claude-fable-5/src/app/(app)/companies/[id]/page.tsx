'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CompanyForm } from '@/components/company-form';
import { useMe } from '@/hooks/use-me';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Pencil, Trash2 } from 'lucide-react';

type Company = { id: string; name: string; domain: string };
type Contact = {
  id: string;
  name: string;
  email: string;
  company_id: string | null;
};

export default function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { canWrite } = useMe();
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/companies/${id}`).then((res) => (res.ok ? res.json() : null)),
      fetch('/api/contacts').then((res) => (res.ok ? res.json() : [])),
    ])
      .then(([companyData, contactsData]: [Company | null, Contact[]]) => {
        setCompany(companyData);
        setContacts(contactsData.filter((c) => c.company_id === id));
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/companies/${id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/companies');
      router.refresh();
    } else {
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }
  if (!company) {
    return <p className="text-sm text-slate-500">Company not found.</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{company.name}</h1>
        {canWrite && (
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditing((v) => !v)}>
            <Pencil className="mr-1.5 h-4 w-4" />
            {editing ? 'Cancel' : 'Edit'}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this company?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete {company.name}. Contacts linked
                  to it will be kept without a company.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting}
                  onClick={handleDelete}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        )}
      </div>

      {editing && canWrite ? (
        <div className="mb-8 rounded-lg border border-slate-200 bg-white p-6">
          <CompanyForm
            companyId={company.id}
            initialValues={{ name: company.name, domain: company.domain }}
            onSaved={(updated) => {
              setCompany(updated);
              setEditing(false);
            }}
          />
        </div>
      ) : (
        <dl className="mb-8 grid max-w-lg grid-cols-1 gap-5 rounded-lg border border-slate-200 bg-white p-6 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Name
            </dt>
            <dd data-testid="company-detail-name" className="mt-0.5 text-slate-900">
              {company.name}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Domain
            </dt>
            <dd data-testid="company-detail-domain" className="mt-0.5 text-slate-900">
              {company.domain || '—'}
            </dd>
          </div>
        </dl>
      )}

      <h2 className="mb-3 text-lg font-semibold text-slate-900">Contacts</h2>
      {contacts.length === 0 ? (
        <div
          data-testid="company-contacts-list"
          className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"
        >
          No contacts linked to this company yet.
        </div>
      ) : (
        <ul
          data-testid="company-contacts-list"
          className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          {contacts.map((contact) => (
            <li
              key={contact.id}
              data-testid="company-contact-row"
              className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{contact.name}</p>
                <p className="truncate text-sm text-slate-500">{contact.email}</p>
              </div>
              <Link
                href={`/contacts/${contact.id}`}
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
