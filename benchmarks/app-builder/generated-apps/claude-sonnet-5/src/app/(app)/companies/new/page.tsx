"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanyForm, type CompanyFormValues } from "@/components/company-form";
import { ForbiddenMessage } from "@/components/forbidden-message";
import { useMe } from "@/lib/use-me";

export default function NewCompanyPage() {
  const router = useRouter();
  const { activeRole, isLoading } = useMe();

  const handleSubmit = async (values: CompanyFormValues) => {
    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.error ?? "Failed to create company";
    }
    const created = await res.json();
    router.push(`/companies/${created.id}`);
  };

  if (isLoading) return null;
  if (activeRole === "viewer") return <ForbiddenMessage />;

  return (
    <div className="max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>New company</CardTitle>
        </CardHeader>
        <CardContent>
          <CompanyForm onSubmit={handleSubmit} submitLabel="Create company" />
        </CardContent>
      </Card>
    </div>
  );
}
