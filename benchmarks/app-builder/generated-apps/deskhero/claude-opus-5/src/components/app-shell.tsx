import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { roleBadgeClasses, type Role } from "@/lib/roles";

type Props = {
  email: string;
  role: Role;
  children: React.ReactNode;
};

const navByRole: Record<Role, { href: string; label: string }[]> = {
  admin: [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/canned", label: "Canned" },
    { href: "/admin/audit", label: "Audit" },
    { href: "/agent", label: "Queues" },
    { href: "/tickets", label: "Tickets" },
  ],
  agent: [
    { href: "/agent", label: "Queues" },
    { href: "/tickets", label: "Tickets" },
  ],
  requester: [{ href: "/tickets", label: "My tickets" }],
};

export function AppShell({ email, role, children }: Props) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
                DH
              </span>
              <span className="text-base font-semibold tracking-tight text-slate-900">
                Deskhero
              </span>
            </Link>
            <nav className="hidden items-center gap-4 md:flex">
              {navByRole[role].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm text-slate-600 transition hover:text-slate-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span
              data-testid="role-badge"
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${roleBadgeClasses[role]}`}
            >
              {role}
            </span>
            <span
              data-testid="user-email"
              className="max-w-[35vw] truncate text-sm text-slate-600"
            >
              {email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
