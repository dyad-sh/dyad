"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

/**
 * The header offers each actor only the surfaces they hold: everybody is a
 * customer, `nav-merchant` appears once a user has created a restaurant and
 * `nav-courier` once they have registered. This is presentation only — every
 * one of those pages authorizes on the server as well.
 */
export function AppHeader({
  email,
  isMerchant,
  isCourier,
}: {
  email: string;
  isMerchant: boolean;
  isCourier: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const nav = [
    { href: "/restaurants", label: "Restaurants", testId: "nav-restaurants" },
    { href: "/orders", label: "My orders", testId: "nav-orders" },
    ...(isMerchant
      ? [
          {
            href: "/merchant/orders",
            label: "Kitchen",
            testId: "nav-merchant",
          },
        ]
      : []),
    ...(isCourier
      ? [{ href: "/courier", label: "Deliver", testId: "nav-courier" }]
      : []),
  ];

  async function signOut() {
    try {
      await authClient.signOut();
    } finally {
      router.push("/auth/sign-in");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <Link href="/restaurants" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-xs font-bold text-white">
            C
          </span>
          <span className="text-sm font-semibold text-zinc-900">Curbside</span>
        </Link>

        <nav className="flex items-center gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              data-testid={item.testId}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-sm font-medium transition",
                pathname === item.href || pathname.startsWith(`${item.href}/`)
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span
            data-testid="user-menu"
            className="max-w-[220px] truncate text-sm text-zinc-600"
          >
            {email}
          </span>
          <button
            type="button"
            data-testid="sign-out-button"
            onClick={signOut}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
