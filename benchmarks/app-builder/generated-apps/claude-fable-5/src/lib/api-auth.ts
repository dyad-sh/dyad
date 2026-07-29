import { auth } from '@/lib/auth/server';

export type SessionUser = { id: string; email: string; name: string };

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const { data: session } = await auth.getSession();
    if (!session?.user) return null;
    const { id, email, name } = session.user;
    return { id, email, name };
  } catch {
    return null;
  }
}

export function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 });
}
