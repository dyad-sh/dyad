import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";
import { homePathForRole, type Role } from "@/lib/roles";
import { ensureUserProfile } from "@/lib/users";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { data: session } = await auth.getSession();
  const user = session?.user;
  if (!user?.id) return null;

  const email = user.email ?? "";
  const profile = await ensureUserProfile({
    id: user.id,
    email,
    name: user.name,
  });

  return {
    id: user.id,
    email,
    name: user.name ?? "",
    role: profile.role,
    active: profile.active,
  };
}

export async function requirePageUser(options?: {
  roles?: Role[];
}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  if (!user.active) {
    redirect("/account-deactivated");
  }

  if (options?.roles && !options.roles.includes(user.role)) {
    redirect(homePathForRole(user.role));
  }

  return user;
}
