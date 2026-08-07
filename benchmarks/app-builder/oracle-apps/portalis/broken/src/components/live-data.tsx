"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 1200;

/**
 * Keeps the current authenticated route's server-rendered data live.
 *
 * Portalis is a multi-user portal: an admin can revoke your role, another
 * teammate can add a project, an invite can be accepted — all while your page
 * sits open. M1's hard requirement is that authenticated pages "reflect writes
 * immediately", which a one-shot server render cannot do on its own. This
 * re-runs the route's server components on a short interval (and whenever the
 * tab regains focus), so lists, counts and role-derived controls converge on
 * the database within about a second without a manual reload.
 *
 * Client state (half-typed forms, a freshly revealed API key) is preserved:
 * `router.refresh()` re-renders, it does not remount.
 */
export function LiveData() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, INTERVAL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  return null;
}
