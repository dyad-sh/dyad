"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DealDetailActions({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/deals/${dealId}`, { method: "DELETE" });
      if (!response.ok) {
        setLoading(false);
        return;
      }
      router.push("/deals");
      router.refresh();
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        type="button"
        variant={confirming ? "outline" : "destructive"}
        onClick={() => setConfirming(true)}
        disabled={loading}
      >
        Delete
      </Button>
      {confirming ? (
        <Button
          type="button"
          variant="destructive"
          onClick={handleDelete}
          disabled={loading}
        >
          {loading ? "Deleting…" : "Confirm delete"}
        </Button>
      ) : null}
    </div>
  );
}
