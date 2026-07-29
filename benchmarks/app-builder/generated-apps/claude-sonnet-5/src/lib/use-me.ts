"use client";

import { useEffect, useState } from "react";
import type { Me } from "@/lib/types";

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe)
      .finally(() => setIsLoading(false));
  }, []);

  const activeRole =
    me?.memberships.find((m) => m.workspaceId === me.activeWorkspaceId)?.role ?? null;

  return { me, activeRole, isLoading };
}
