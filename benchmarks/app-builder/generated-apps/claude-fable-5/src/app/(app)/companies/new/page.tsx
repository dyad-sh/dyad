'use client';

import { useRouter } from 'next/navigation';
import { CompanyForm } from '@/components/company-form';

export default function NewCompanyPage() {
  const router = useRouter();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">New company</h1>
      <CompanyForm
        onSaved={(company) => {
          router.push(`/companies/${company.id}`);
          router.refresh();
        }}
      />
    </div>
  );
}
