import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { unauthorized } from "@/lib/http";

/**
 * The signed-in user, as the managed auth service reports them. `id` is an
 * opaque 32-character string — it is stored as `text` everywhere and never
 * parsed, coerced or treated as a uuid.
 */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export async function currentUser(): Promise<SessionUser | null> {
  const { data } = await auth.getSession();
  const user = data?.user;
  if (!user) return null;
  return {
    id: String(user.id),
    email: String(user.email ?? ""),
    name: String(user.name ?? ""),
  };
}

/** JSON routes: no session is a 401 with no data. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw unauthorized();
  return user;
}

/** Pages: a signed-out visitor is sent to the sign-in screen. */
export async function requirePageUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/auth/sign-in");
  return user;
}
