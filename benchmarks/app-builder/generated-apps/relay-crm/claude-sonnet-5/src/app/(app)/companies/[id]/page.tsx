"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompanyForm, type CompanyFormValues } from "@/components/company-form";
import { useMe } from "@/lib/use-me";

type CompanyContact = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
};

type CompanyDetail = {
  id: string;
  name: string;
  domain: string | null;
  contacts: CompanyContact[];
};

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { activeRole } = useMe();
  const canWrite = activeRole === "owner" || activeRole === "member";

  const load = () => {
    fetch(`/api/companies/${params.id}`).then(async (res) => {
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      setCompany(await res.json());
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const handleUpdate = async (values: CompanyFormValues) => {
    const res = await fetch(`/api/companies/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return data.error ?? "Failed to update company";
    }
    setIsEditing(false);
    load();
  };

  const handleDelete = async () => {
    await fetch(`/api/companies/${params.id}`, { method: "DELETE" });
    router.push("/companies");
  };

  if (notFound) {
    return <p className="text-slate-500">Company not found.</p>;
  }

  if (!company) {
    return null;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle data-testid="company-detail-name">{company.name}</CardTitle>
          {canWrite && !isEditing && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="company-edit-button"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </Button>
              {!confirmingDelete ? (
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="company-delete-button"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="company-delete-confirm"
                  onClick={handleDelete}
                >
                  Confirm delete
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <CompanyForm
              defaultValues={{ name: company.name, domain: company.domain ?? "" }}
              onSubmit={handleUpdate}
              submitLabel="Save changes"
            />
          ) : (
            <div className="flex justify-between border-b border-slate-100 py-2 text-sm">
              <span className="text-slate-500">Domain</span>
              <span data-testid="company-detail-domain" className="text-slate-900">
                {company.domain || "—"}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          {company.contacts.length === 0 ? (
            <p className="text-sm text-slate-500">No contacts linked to this company.</p>
          ) : (
            <ul data-testid="company-contacts-list" className="divide-y divide-slate-100">
              {company.contacts.map((contact) => (
                <li
                  key={contact.id}
                  data-testid="company-contact-row"
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-900">{contact.name}</p>
                    <p className="text-slate-500">{contact.email}</p>
                  </div>
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="font-medium text-slate-900 underline-offset-4 hover:underline"
                  >
                    View
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
