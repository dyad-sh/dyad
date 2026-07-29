'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ActivityTimeline } from '@/components/activity-timeline';
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

type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  company_id: string | null;
  company_name: string | null;
};

export default function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { canWrite } = useMe();
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/contacts/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Contact | null) => setContact(data))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/contacts');
      router.refresh();
    } else {
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }
  if (!contact) {
    return <p className="text-sm text-slate-500">Contact not found.</p>;
  }

  const field = (label: string, testId: string, value: string) => (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd data-testid={testId} className="mt-0.5 text-slate-900">
        {value || '—'}
      </dd>
    </div>
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{contact.name}</h1>
        {canWrite && (
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" data-testid="contact-edit-button">
            <Link href={`/contacts/${contact.id}/edit`}>
              <Pencil className="mr-1.5 h-4 w-4" />
              Edit
            </Link>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" data-testid="contact-delete-button">
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete {contact.name}. This action
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  data-testid="contact-delete-confirm"
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
      <dl className="grid max-w-lg grid-cols-1 gap-5 rounded-lg border border-slate-200 bg-white p-6 sm:grid-cols-2">
        {field('Name', 'contact-detail-name', contact.name)}
        {field('Email', 'contact-detail-email', contact.email)}
        {field('Phone', 'contact-detail-phone', contact.phone)}
        {field('Title', 'contact-detail-title', contact.title)}
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Company
          </dt>
          <dd data-testid="contact-detail-company" className="mt-0.5 text-slate-900">
            {contact.company_id && contact.company_name ? (
              <Link
                href={`/companies/${contact.company_id}`}
                className="text-indigo-600 hover:text-indigo-700"
              >
                {contact.company_name}
              </Link>
            ) : (
              '—'
            )}
          </dd>
        </div>
      </dl>
      <ActivityTimeline contactId={contact.id} canWrite={canWrite} />
    </div>
  );
}
