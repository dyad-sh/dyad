'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { authClient } from '@/lib/auth/client';

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const isSignup = mode === 'sign-up';
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      if (isSignup) {
        await authClient.signUp.email({
          name: String(form.get('name')),
          email: String(form.get('email')),
          password: String(form.get('password')),
        });
      } else {
        await authClient.signIn.email({
          email: String(form.get('email')),
          password: String(form.get('password')),
        });
      }
      window.location.assign('/contacts');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to continue.');
    } finally {
      setPending(false);
    }
  }

  const id = isSignup ? 'signup' : 'signin';
  return <main className="min-h-screen bg-slate-950 px-5 py-12 text-slate-900"><div className="mx-auto flex min-h-[75vh] max-w-md items-center"><section className="w-full rounded-3xl bg-white p-8 shadow-2xl shadow-cyan-950/40"><div className="mb-8"><div className="mb-4 inline-flex size-10 items-center justify-center rounded-xl bg-cyan-500 font-bold text-slate-950">R</div><p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-600">Relay CRM</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{isSignup ? 'Create your workspace' : 'Welcome back'}</h1><p className="mt-2 text-slate-500">{isSignup ? 'Start building better customer relationships.' : 'Sign in to continue to Relay.'}</p></div><form onSubmit={submit} className="space-y-4">{isSignup && <label className="block text-sm font-medium">Name<input required name="name" data-testid="signup-name" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label>}<label className="block text-sm font-medium">Email<input required type="email" name="email" data-testid={`${id}-email`} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label><label className="block text-sm font-medium">Password<input required minLength={8} type="password" name="password" data-testid={`${id}-password`} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label><p data-testid={`${id}-error`} aria-live="polite" className="min-h-5 text-sm text-red-600">{error}</p><button disabled={pending} data-testid={`${id}-submit`} className="w-full rounded-xl bg-cyan-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60">{pending ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}</button></form><p className="mt-6 text-center text-sm text-slate-500">{isSignup ? 'Already have an account?' : 'New to Relay?'} <Link className="font-semibold text-cyan-700 hover:text-cyan-600" href={isSignup ? '/auth/sign-in' : '/auth/sign-up'}>{isSignup ? 'Sign in' : 'Create an account'}</Link></p></section></div></main>;
}
