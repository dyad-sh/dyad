'use client';

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Values = { name: string; domain: string };

export function CompanyForm({ company }: { company?: Values & { id: string } }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<Values>({ defaultValues: company ?? { name: "", domain: "" } });
  const onSubmit = async (values: Values) => {
    setError("");
    const response = await fetch(company ? `/api/companies/${company.id}` : "/api/companies", { method: company ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const data = await response.json();
    if (!response.ok) { setError(data.error || "Unable to save company"); return; }
    router.push(`/companies/${data.id}`); router.refresh();
  };
  const remove = async () => {
    if (!company) return;
    const response = await fetch(`/api/companies/${company.id}`, { method: "DELETE" });
    if (response.ok) { router.push("/companies"); router.refresh(); }
  };
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="space-y-2"><Label htmlFor="company-name">Name</Label><Input id="company-name" required data-testid="company-form-name" {...register("name")} /></div>
      <div className="space-y-2"><Label htmlFor="company-domain">Domain</Label><Input id="company-domain" placeholder="example.com" data-testid="company-form-domain" {...register("domain")} /></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit" className="bg-indigo-600 hover:bg-indigo-700" disabled={isSubmitting} data-testid="company-form-submit">{isSubmitting ? "Saving…" : company ? "Save changes" : "Create company"}</Button>{company && (!confirming ? <Button type="button" variant="outline" className="text-red-600" onClick={() => setConfirming(true)}>Delete</Button> : <Button type="button" variant="destructive" onClick={remove}>Confirm delete</Button>)}</div>
    </form>
  );
}
