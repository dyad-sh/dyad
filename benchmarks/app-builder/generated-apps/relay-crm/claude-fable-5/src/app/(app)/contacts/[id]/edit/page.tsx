'use client';

import { use, useEffect, useState } from 'react';
import { ContactForm, ContactFormValues } from '@/components/contact-form';

export default function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [values, setValues] = useState<ContactFormValues | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/contacts/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) =>
        setValues(
          data
            ? {
                name: data.name,
                email: data.email,
                phone: data.phone,
                title: data.title,
                company_id: data.company_id,
              }
            : null,
        ),
      )
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }
  if (!values) {
    return <p className="text-sm text-slate-500">Contact not found.</p>;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-900">Edit contact</h1>
      <ContactForm contactId={id} initialValues={values} />
    </div>
  );
}
