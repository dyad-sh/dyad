"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DealForm, type DealFormValues } from "@/components/deal-form";
import { useMe } from "@/lib/use-me";
import type { Contact, Deal } from "@/lib/types";

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

function formatAmount(amount: number) {
  return `$${amount.toLocaleString("en-US")}`;
}

export default function DealDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { activeRole } = useMe();
  const canWrite = activeRole === "owner" || activeRole === "member";

  const load = () => {
    fetch(`/api/deals/${params.id}`).then(async (res) => {
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      setDeal(await res.json());
    });
  };

  useEffect(() => {
    load();
    fetch("/api/contacts")
      .then((res) => (res.ok ? res.json() : []))
      .then(setContacts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const handleUpdate = async (values: DealFormValues) => {
    const amount = Number(values.amount);
    if (!Number.isInteger(amount) || amount < 0) {
      return "Amount must be a whole number of dollars";
    }
    const res = await fetch(`/api/deals/${params.id}`, {
      method: "PATCH",
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
      return data.error ?? "Failed to update deal";
    }
    setIsEditing(false);
    load();
  };

  const handleDelete = async () => {
    await fetch(`/api/deals/${params.id}`, { method: "DELETE" });
    router.push("/deals");
  };

  if (notFound) {
    return <p className="text-slate-500">Deal not found.</p>;
  }

  if (!deal) {
    return null;
  }

  return (
    <div className="max-w-xl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle data-testid="deal-detail-title">{deal.title}</CardTitle>
          {canWrite && !isEditing && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
              {!confirmingDelete ? (
                <Button variant="destructive" size="sm" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              ) : (
                <Button variant="destructive" size="sm" onClick={handleDelete}>
                  Confirm delete
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <DealForm
              contacts={contacts}
              defaultValues={{
                title: deal.title,
                amount: String(deal.amount),
                stage: deal.stage,
                contactId: deal.contactId ?? "",
              }}
              onSubmit={handleUpdate}
              submitLabel="Save changes"
            />
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between border-b border-slate-100 py-2">
                <span className="text-slate-500">Amount</span>
                <span data-testid="deal-detail-amount" className="text-slate-900">
                  {formatAmount(deal.amount)}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-100 py-2">
                <span className="text-slate-500">Stage</span>
                <span data-testid="deal-detail-stage" className="text-slate-900">
                  {STAGE_LABELS[deal.stage]}
                </span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-slate-500">Contact</span>
                <span className="text-slate-900">{deal.contactName || "—"}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
