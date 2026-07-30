import { auth } from '@/lib/auth/server';

export async function getCurrentUser() {
  const { data: session } = await auth.getSession();
  return session?.user ?? null;
}
