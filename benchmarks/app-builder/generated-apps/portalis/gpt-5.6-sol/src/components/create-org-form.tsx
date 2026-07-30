"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  name: z.string().trim().min(1, "Organization name is required."),
  slug: z.string().min(1, "Slug is required.").regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens."),
});
type Values = z.infer<typeof schema>;

export function CreateOrgForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState("");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) });

  async function onSubmit(values: Values) {
    setServerError("");
    const response = await fetch("/api/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const data = await response.json();
    if (!response.ok) {
      setServerError(data.error ?? "Unable to create the organization.");
      return;
    }
    router.push(`/orgs/${data.id}`);
    router.refresh();
  }

  const error = serverError || errors.name?.message || errors.slug?.message;
  return (
    <form className="space-y-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="space-y-2"><Label htmlFor="org-name">Organization name</Label><Input id="org-name" className="h-11" placeholder="Acme, Inc." data-testid="org-name-input" {...register("name")} /></div>
      <div className="space-y-2"><Label htmlFor="org-slug">Slug</Label><Input id="org-slug" className="h-11" placeholder="acme" data-testid="org-slug-input" {...register("slug", { onChange: (event) => { event.target.value = event.target.value.toLowerCase(); } })} /><p className="text-xs text-slate-500">Used as a unique, lowercase identifier.</p></div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-testid="create-org-error">{error}</p>}
      <Button type="submit" className="bg-sky-600 hover:bg-sky-700" disabled={isSubmitting} data-testid="create-org-submit">{isSubmitting && <Loader2 className="animate-spin" />}Create organization</Button>
    </form>
  );
}
