import { createNeonAuth } from "@neondatabase/auth/next/server";

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
  },
});

export type SessionUser = { id: string; email: string; name: string };

/** The session user, read on the server from the session cookie. */
export async function currentUser(): Promise<SessionUser | null> {
  const { data } = await auth.getSession();
  const user = data?.user;
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name ?? "" };
}
