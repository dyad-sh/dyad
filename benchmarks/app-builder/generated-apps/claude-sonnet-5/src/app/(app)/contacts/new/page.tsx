"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContactForm, type ContactFormValues } from "@/components/contact-form";
import { ForbiddenMessage } from "@/components/forbidden-message";
import { useMe } from "@/lib/use-me";
import type { Company } from "@/lib/types";

export default function NewContactPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const { activeRole, isLoading } = useMe();

  useEffect(() => {
    fetch("/api/companies")
      .then((res) => (res.ok ? res.json() : []))
      .then(setCompanies);
  }, []);

  const handleSubmit = async (values: ContactFormValues) => {
    const res = await fetch("/api/contacts", {
      method: "POST",
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
      return data.error ?? "Failed to create contact";
    }
    const created = await res.json();
    router.push(`/contacts/${created.id}`);
  };

  if (isLoading) return null;
  if (activeRole === "viewer") return <ForbiddenMessage />;

  return (
    <div className="max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>New contact</CardTitle>
        </CardHeader>
        <CardContent>
          <ContactForm companies={companies} onSubmit={handleSubmit} submitLabel="Create contact" />
        </CardContent>
      </Card>
    </div>
  );
}
