'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useMe } from '@/hooks/use-me';
import { Plus } from 'lucide-react';

type Company = { id: string; name: string; domain: string };

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const { canWrite } = useMe();

  useEffect(() => {
    fetch('/api/companies')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Company[]) => setCompanies(data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">Companies</h1>
        {canWrite && (
          <Button asChild data-testid="company-new-button" className="bg-indigo-600 hover:bg-indigo-700">
            <Link href="/companies/new">
              <Plus className="mr-1.5 h-4 w-4" />
              New company
            </Link>
          </Button>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : companies.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No companies yet. Create your first company to get started.
        </div>
      ) : (
        <ul
          data-testid="companies-list"
          className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          {companies.map((company) => (
            <li
              key={company.id}
              data-testid="company-row"
              className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <p data-testid="company-row-name" className="font-medium text-slate-900">
                  {company.name}
                </p>
                <p className="truncate text-sm text-slate-500">{company.domain}</p>
              </div>
              <Link
                href={`/companies/${company.id}`}
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
