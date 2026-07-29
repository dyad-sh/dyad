'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient, useAuthSession } from '@/lib/auth/client';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { Button } from '@/components/ui/button';
import { useMe } from '@/hooks/use-me';
import { cn } from '@/lib/utils';
import { LogOut } from 'lucide-react';

export function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useAuthSession();
  const { isOwner } = useMe();

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push('/auth/sign-in');
    router.refresh();
  };

  const navLink = (href: string, label: string, testId: string) => (
    <Link
      href={href}
      data-testid={testId}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        pathname.startsWith(href)
          ? 'bg-indigo-50 text-indigo-700'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
    >
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/contacts" className="flex items-center gap-2 font-bold text-slate-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-sm text-white">
            R
          </span>
          <span className="hidden sm:inline">Relay CRM</span>
        </Link>
        <WorkspaceSwitcher />
        <nav className="flex items-center gap-1">
          {navLink('/contacts', 'Contacts', 'nav-contacts')}
          {navLink('/companies', 'Companies', 'nav-companies')}
          {navLink('/deals', 'Deals', 'nav-deals')}
          {isOwner && navLink('/settings/members', 'Members', 'nav-members')}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span data-testid="user-menu" className="text-sm text-slate-600">
            {session?.user?.email ?? ''}
          </span>
          <Button
            variant="outline"
            size="sm"
            data-testid="sign-out-button"
            onClick={handleSignOut}
          >
            <LogOut className="mr-1.5 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
