"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ContactDetailActions({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/contacts/${contactId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setLoading(false);
        return;
      }
      router.push("/contacts");
      router.refresh();
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild variant="outline">
        <Link href={`/contacts/${contactId}/edit`} data-testid="contact-edit-button">
          Edit
        </Link>
      </Button>
      <Button
        type="button"
        variant={confirming ? "outline" : "destructive"}
        data-testid="contact-delete-button"
        onClick={() => setConfirming(true)}
        disabled={loading}
      >
        Delete
      </Button>
      {confirming ? (
        <Button
          type="button"
          variant="destructive"
          data-testid="contact-delete-confirm"
          onClick={handleDelete}
          disabled={loading}
        >
          {loading ? "Deleting…" : "Confirm delete"}
        </Button>
      ) : null}
    </div>
  );
}
