'use client';

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dealStages, type DealStage } from "@/components/deals-board";

type Contact = { id: string; name: string };
type Values = { title: string; amount: number; stage: DealStage; contactId: string };

export function DealForm({ contacts }: { contacts: Contact[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<Values>({ defaultValues: { title: "", amount: 0, stage: "lead", contactId: "" } });
  const submit = async (values: Values) => {
    setError("");
    try {
      const response = await fetch("/api/deals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create deal");
      router.push(`/deals/${data.id}`); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to create deal"); }
  };
  return <form onSubmit={handleSubmit(submit)} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><div className="space-y-2"><Label htmlFor="deal-title">Title</Label><Input id="deal-title" required data-testid="deal-form-title" {...register("title")} /></div><div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="deal-amount">Amount</Label><Input id="deal-amount" type="number" min="0" step="1" required data-testid="deal-form-amount" {...register("amount", { valueAsNumber: true })} /></div><div className="space-y-2"><Label htmlFor="deal-stage">Stage</Label><select id="deal-stage" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" data-testid="deal-form-stage" {...register("stage")}>{dealStages.map((stage) => <option key={stage} value={stage}>{stage.charAt(0).toUpperCase() + stage.slice(1)}</option>)}</select></div></div><div className="space-y-2"><Label htmlFor="deal-contact">Contact</Label><select id="deal-contact" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" data-testid="deal-form-contact" {...register("contactId")}><option value="">No contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></div><p className="min-h-5 text-sm text-red-600" role="alert" data-testid="deal-form-error">{error}</p><Button type="submit" disabled={isSubmitting} data-testid="deal-form-submit">{isSubmitting ? "Creating…" : "Create deal"}</Button></form>;
}
