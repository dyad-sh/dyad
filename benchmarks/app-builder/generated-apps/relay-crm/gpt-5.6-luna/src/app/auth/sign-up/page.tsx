'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth/client';
import '../auth.css';

export default function SignUpPage() {
  const router = useRouter(); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(''); setPending(true); const form = new FormData(event.currentTarget); try { await authClient.signUp.email({ name: String(form.get('name')), email: String(form.get('email')), password: String(form.get('password')) }); await fetch('/api/me'); router.push('/contacts'); router.refresh(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to create account.'); } finally { setPending(false); } }
  return <main className="auth-shell flex items-center justify-center p-6"><div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60"><div className="mb-8"><div className="mb-6 flex items-center gap-2 font-semibold"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white"><Radio className="h-5 w-5" /></span>Relay CRM</div><p className="mb-2 text-sm font-medium text-indigo-600">Start your workspace</p><h1 className="text-3xl font-semibold tracking-tight text-slate-950">Create your account</h1><p className="mt-2 text-sm text-slate-500">Bring every important relationship into focus.</p></div><form onSubmit={submit} className="space-y-5"><label className="block text-sm font-medium text-slate-700">Name<Input data-testid="signup-name" name="name" required className="mt-2 h-11" /></label><label className="block text-sm font-medium text-slate-700">Email<Input data-testid="signup-email" name="email" type="email" required className="mt-2 h-11" /></label><label className="block text-sm font-medium text-slate-700">Password<Input data-testid="signup-password" name="password" type="password" minLength={8} required className="mt-2 h-11" /></label>{error && <p data-testid="signup-error" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}<Button data-testid="signup-submit" disabled={pending} className="h-11 w-full">{pending ? 'Creating account…' : 'Create account'}<ArrowRight className="h-4 w-4" /></Button></form><p className="mt-6 text-center text-sm text-slate-500">Already have an account? <Link href="/auth/sign-in" className="font-medium text-slate-900 hover:underline">Sign in</Link></p></div></main>;

}
