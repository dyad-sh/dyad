import { createNeonAuth } from "@neondatabase/auth/next/server";

/** The project's managed email/password auth service. Server side only. */
export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL!,
  cookies: {
    secret: process.env.NEON_AUTH_COOKIE_SECRET!,
  },
});

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/**
 * The caller's own identity, or null. The session user id is an opaque
 * 32-character string and is stored as `text` everywhere.
 */
export async function sessionUser(): Promise<SessionUser | null> {
  const { data } = await auth.getSession();
  const user = data?.user;
  if (!user) return null;
  return {
    id: String(user.id),
    email: String(user.email ?? ""),
    name: String(user.name ?? ""),
  };
}
