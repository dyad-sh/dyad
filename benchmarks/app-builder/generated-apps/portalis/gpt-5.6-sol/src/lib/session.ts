import "server-only";

import { redirect } from "next/navigation";
import { sql } from "@/db";
import { auth } from "@/lib/auth/server";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user) return null;

  const rows = await sql`
    INSERT INTO app_users (auth_user_id, email, name)
    VALUES (${session.user.id}, ${session.user.email}, ${session.user.name})
    ON CONFLICT (auth_user_id) DO UPDATE
    SET email = EXCLUDED.email, name = EXCLUDED.name, updated_at = now()
    RETURNING id, email, name
  `;
  return rows[0] as CurrentUser;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in");
  return user;
}
