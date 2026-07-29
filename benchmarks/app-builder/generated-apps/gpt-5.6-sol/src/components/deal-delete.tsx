'use client';

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function DealDelete({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const remove = async () => { const response = await fetch(`/api/deals/${id}`, { method: "DELETE" }); if (response.ok) { router.push("/deals"); router.refresh(); } };
  return confirming ? <div className="flex gap-2"><Button variant="destructive" onClick={remove}>Confirm delete</Button><Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button></div> : <Button variant="outline" className="text-red-600" onClick={() => setConfirming(true)}>Delete deal</Button>;
}
