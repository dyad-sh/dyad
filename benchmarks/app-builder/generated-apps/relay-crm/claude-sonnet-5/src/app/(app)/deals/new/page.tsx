"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DealForm, type DealFormValues } from "@/components/deal-form";
import { ForbiddenMessage } from "@/components/forbidden-message";
import { useMe } from "@/lib/use-me";
import type { Contact } from "@/lib/types";

export default function NewDealPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const { activeRole, isLoading } = useMe();

  useEffect(() => {
    fetch("/api/contacts")
      .then((res) => (res.ok ? res.json() : []))
      .then(setContacts);
  }, []);

  const handleSubmit = async (values: DealFormValues) => {
    const amount = Number(values.amount);
    if (!Number.isInteger(amount) || amount < 0) {
      return "Amount must be a whole number of dollars";
    }
    const res = await fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: values.title,
        amount,
        stage: values.stage,
        contactId: values.contactId || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.error ?? "Failed to create deal";
    }
    const created = await res.json();
    router.push(`/deals/${created.id}`);
  };

  if (isLoading) return null;
  if (activeRole === "viewer") return <ForbiddenMessage />;

  return (
    <div className="max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>New deal</CardTitle>
        </CardHeader>
        <CardContent>
          <DealForm contacts={contacts} onSubmit={handleSubmit} submitLabel="Create deal" />
        </CardContent>
      </Card>
    </div>
  );
}
