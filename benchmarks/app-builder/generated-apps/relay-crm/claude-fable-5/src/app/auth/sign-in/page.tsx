'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authClient.signIn.email({ email, password });
      router.push('/contacts');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-white to-indigo-100 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-2xl font-bold text-slate-900">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white text-lg">
              R
            </span>
            Relay CRM
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Sign in to manage your contacts and companies
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-indigo-100/50">
          <h1 className="text-lg font-semibold text-slate-900 mb-6">Sign in</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                data-testid="signin-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                data-testid="signin-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p
                data-testid="signin-error"
                className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
              >
                {error}
              </p>
            )}
            <Button
              type="submit"
              data-testid="signin-submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-500">
            Don&apos;t have an account?{' '}
            <Link
              href="/auth/sign-up"
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
