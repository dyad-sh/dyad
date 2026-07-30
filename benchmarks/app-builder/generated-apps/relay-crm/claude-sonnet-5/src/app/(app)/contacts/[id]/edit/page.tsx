"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContactForm, type ContactFormValues } from "@/components/contact-form";
import { ForbiddenMessage } from "@/components/forbidden-message";
import { useMe } from "@/lib/use-me";
import type { Company, Contact } from "@/lib/types";

export default function EditContactPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { activeRole, isLoading } = useMe();

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => (res.ok ? res.json() : []))
      .then(setCompanies);
    fetch(`/api/contacts/${params.id}`).then(async (res) => {
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      setContact(await res.json());
    });
  }, [params.id]);

  const handleSubmit = async (values: ContactFormValues) => {
    const res = await fetch(`/api/contacts/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        email: values.email,
        phone: values.phone,
        title: values.title,
        companyId: values.companyId || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.error ?? "Failed to update contact";
    }
    router.push(`/contacts/${params.id}`);
  };

  if (isLoading) return null;
  if (activeRole === "viewer") return <ForbiddenMessage />;

  if (notFound) {
    return <p className="text-slate-500">Contact not found.</p>;
  }

  if (!contact) {
    return null;
  }

  return (
    <div className="max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Edit contact</CardTitle>
        </CardHeader>
        <CardContent>
          <ContactForm
            companies={companies}
            defaultValues={{
              name: contact.name,
              email: contact.email,
              phone: contact.phone ?? "",
              title: contact.title ?? "",
              companyId: contact.companyId ?? "",
            }}
            onSubmit={handleSubmit}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </div>
  );
}
