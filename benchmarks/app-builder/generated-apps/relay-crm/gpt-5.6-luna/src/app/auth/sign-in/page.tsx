'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth/client';
import '../auth.css';

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(''); setPending(true); const form = new FormData(event.currentTarget); try { await authClient.signIn.email({ email: String(form.get('email')), password: String(form.get('password')) }); await fetch('/api/me'); router.push('/contacts'); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in.'); } finally { setPending(false); } }
  return <main className="auth-shell flex items-center justify-center p-6"><div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60"><div className="mb-8"><div className="mb-6 flex items-center gap-2 font-semibold"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white"><Radio className="h-5 w-5" /></span>Relay CRM</div><p className="mb-2 text-sm font-medium text-indigo-600">Welcome back</p><h1 className="text-3xl font-semibold tracking-tight text-slate-950">Sign in to Relay</h1><p className="mt-2 text-sm text-slate-500">Your relationships, organized and ready.</p></div><form onSubmit={submit} className="space-y-5"><label className="block text-sm font-medium text-slate-700">Email<Input data-testid="signin-email" name="email" type="email" required className="mt-2 h-11" /></label><label className="block text-sm font-medium text-slate-700">Password<Input data-testid="signin-password" name="password" type="password" required className="mt-2 h-11" /></label>{error && <p data-testid="signin-error" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<Button data-testid="signin-submit" disabled={pending} className="h-11 w-full">{pending ? 'Signing in…' : 'Sign in'}<ArrowRight className="h-4 w-4" /></Button></form><p className="mt-6 text-center text-sm text-slate-500">New to Relay? <Link href="/auth/sign-up" className="font-medium text-slate-900 hover:underline">Create an account</Link></p></div></main>;

}
