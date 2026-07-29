'use client';

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ContactDelete({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const remove = async () => {
    const response = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    if (response.ok) { router.push("/contacts"); router.refresh(); }
  };
  return confirming ? (
    <div className="flex items-center gap-2 rounded-lg bg-red-50 p-2"><span className="px-2 text-sm text-red-700">Delete this contact?</span><Button size="sm" variant="destructive" onClick={remove} data-testid="contact-delete-confirm">Confirm delete</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button></div>
  ) : <Button variant="outline" onClick={() => setConfirming(true)} className="text-red-600" data-testid="contact-delete-button">Delete</Button>;
}
