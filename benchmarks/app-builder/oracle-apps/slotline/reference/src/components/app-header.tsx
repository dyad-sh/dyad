"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { CLINIC_TZ } from "@/lib/clinic-time";
import type { Role } from "@/lib/roles";

const linkClass = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
    active
      ? "bg-slate-900 text-white"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;

export function AppHeader({ email, role }: { email: string; role: Role }) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await authClient.signOut();
    } catch {
      // Signing out is best-effort on the client; the server session is what
      // decides, and the redirect below re-checks it.
    } finally {
      setBusy(false);
      router.push("/auth/sign-in");
      router.refresh();
    }
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-3">
        <Link href="/bookings" className="text-base font-semibold">
          Slotline
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          <Link
            href="/bookings"
            data-testid="nav-bookings"
            className={linkClass(pathname.startsWith("/bookings"))}
          >
            Bookings
          </Link>
          <Link
            href="/practitioners"
            data-testid="nav-practitioners"
            className={linkClass(pathname.startsWith("/practitioners"))}
          >
            Practitioners
          </Link>
          <Link
            href="/services"
            data-testid="nav-services"
            className={linkClass(pathname.startsWith("/services"))}
          >
            Services
          </Link>
          {/* Staff-only navigation is not rendered to patients — and the pages
              behind it deny them on the server regardless. */}
          {role === "staff" ? (
            <Link
              href="/staff/schedule"
              data-testid="nav-schedule"
              className={linkClass(pathname.startsWith("/staff/schedule"))}
            >
              Schedule
            </Link>
          ) : null}
          {role === "patient" ? (
            <Link
              href="/staff/join"
              data-testid="nav-staff-join"
              className={linkClass(pathname.startsWith("/staff/join"))}
            >
              Staff access
            </Link>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span
            data-testid="role-badge"
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              role === "staff"
                ? "bg-indigo-50 text-indigo-700"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            {role}
          </span>
          <span
            data-testid="clinic-timezone"
            title="The clinic's timezone"
            className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
          >
            {CLINIC_TZ}
          </span>
          <span
            data-testid="user-menu"
            className="text-sm text-slate-600"
            title={email}
          >
            {email}
          </span>
          <button
            type="button"
            data-testid="sign-out-button"
            onClick={signOut}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
