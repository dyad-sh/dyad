import { auth } from '@/lib/auth/server';

export async function getCurrentUser() {
  const { data } = await auth.getSession();
  return data?.user ?? null;
}
