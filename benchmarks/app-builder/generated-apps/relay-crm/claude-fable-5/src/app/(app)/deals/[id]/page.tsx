'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DealForm } from '@/components/deal-form';
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

type Deal = {
  id: string;
  title: string;
  amount: number;
  stage: string;
  contact_id: string | null;
  contact_name: string | null;
};

export default function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { canWrite } = useMe();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/deals/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Deal | null) => setDeal(data))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    setDeleting(true);
    const res = await fetch(`/api/deals/${id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/deals');
      router.refresh();
    } else {
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }
  if (!deal) {
    return <p className="text-sm text-slate-500">Deal not found.</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{deal.title}</h1>
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
                <AlertDialogTitle>Delete this deal?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete {deal.title}. This action cannot
                  be undone.
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
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <DealForm
            dealId={deal.id}
            initialValues={{
              title: deal.title,
              amount: deal.amount,
              stage: deal.stage,
              contact_id: deal.contact_id,
            }}
          />
        </div>
      ) : (
        <dl className="grid max-w-lg grid-cols-1 gap-5 rounded-lg border border-slate-200 bg-white p-6 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Title
            </dt>
            <dd data-testid="deal-detail-title" className="mt-0.5 text-slate-900">
              {deal.title}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Amount
            </dt>
            <dd data-testid="deal-detail-amount" className="mt-0.5 text-slate-900">
              ${deal.amount}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Stage
            </dt>
            <dd data-testid="deal-detail-stage" className="mt-0.5 text-slate-900">
              {deal.stage}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Contact
            </dt>
            <dd className="mt-0.5 text-slate-900">
              {deal.contact_id && deal.contact_name ? (
                <Link
                  href={`/contacts/${deal.contact_id}`}
                  className="text-indigo-600 hover:text-indigo-700"
                >
                  {deal.contact_name}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
