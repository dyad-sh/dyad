'use client';

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Company = { id: string; name: string };
type Values = { name: string; email: string; phone: string; title: string; companyId: string };

export function ContactForm({ contact, companies }: { contact?: Values & { id: string }; companies: Company[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<Values>({ defaultValues: contact ?? { name: "", email: "", phone: "", title: "", companyId: "" } });

  const onSubmit = async (values: Values) => {
    setError("");
    try {
      const response = await fetch(contact ? `/api/contacts/${contact.id}` : "/api/contacts", {
        method: contact ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save contact");
      router.push(`/contacts/${data.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save contact");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="contact-name">Name</Label><Input id="contact-name" required data-testid="contact-form-name" {...register("name")} /></div>
        <div className="space-y-2"><Label htmlFor="contact-email">Email</Label><Input id="contact-email" type="email" data-testid="contact-form-email" {...register("email")} /></div>
        <div className="space-y-2"><Label htmlFor="contact-phone">Phone</Label><Input id="contact-phone" type="tel" data-testid="contact-form-phone" {...register("phone")} /></div>
        <div className="space-y-2"><Label htmlFor="contact-title">Title</Label><Input id="contact-title" data-testid="contact-form-title" {...register("title")} /></div>
        <div className="space-y-2"><Label htmlFor="contact-company">Company</Label><select id="contact-company" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring" data-testid="contact-form-company" {...register("companyId")}><option value="">No company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
      </div>
      <p className="min-h-5 text-sm text-red-600" role="alert" data-testid="contact-form-error">{error}</p>
      <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700" disabled={isSubmitting} data-testid="contact-form-submit">{isSubmitting ? "Saving…" : contact ? "Save changes" : "Create contact"}</Button>
    </form>
  );
}
