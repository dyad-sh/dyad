"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityTimeline } from "@/components/activity-timeline";
import { useMe } from "@/lib/use-me";
import type { Contact } from "@/lib/types";

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { activeRole } = useMe();
  const canWrite = activeRole === "owner" || activeRole === "member";

  useEffect(() => {
    fetch(`/api/contacts/${params.id}`).then(async (res) => {
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      setContact(await res.json());
    });
  }, [params.id]);

  const handleDelete = async () => {
    await fetch(`/api/contacts/${params.id}`, { method: "DELETE" });
    router.push("/contacts");
  };

  if (notFound) {
    return <p className="text-slate-500">Contact not found.</p>;
  }

  if (!contact) {
    return null;
  }

  return (
    <div className="max-w-xl space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle data-testid="contact-detail-name">{contact.name}</CardTitle>
          {canWrite && (
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm" data-testid="contact-edit-button">
                <Link href={`/contacts/${contact.id}/edit`}>Edit</Link>
              </Button>
              {!confirmingDelete ? (
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="contact-delete-button"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="contact-delete-confirm"
                  onClick={handleDelete}
                >
                  Confirm delete
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between border-b border-slate-100 py-2">
            <span className="text-slate-500">Email</span>
            <span data-testid="contact-detail-email" className="text-slate-900">
              {contact.email}
            </span>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-2">
            <span className="text-slate-500">Phone</span>
            <span data-testid="contact-detail-phone" className="text-slate-900">
              {contact.phone || "—"}
            </span>
          </div>
          <div className="flex justify-between border-b border-slate-100 py-2">
            <span className="text-slate-500">Title</span>
            <span data-testid="contact-detail-title" className="text-slate-900">
              {contact.title || "—"}
            </span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-slate-500">Company</span>
            <span data-testid="contact-detail-company" className="text-slate-900">
              {contact.companyName || "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityTimeline contactId={contact.id} canAddNotes={canWrite} />
        </CardContent>
      </Card>
    </div>
  );
}
