import { auth } from "@/lib/auth/server";
import type { Role } from "@/lib/roles";
import { ensureUserProfile } from "@/lib/users";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
};

export async function requireUser(): Promise<
  { user: AuthUser } | { response: Response }
> {
  const { data: session } = await auth.getSession();
  const user = session?.user;

  if (!user?.id) {
    return {
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const email = user.email ?? "";
  const profile = await ensureUserProfile({
    id: user.id,
    email,
    name: user.name,
  });

  if (!profile.active) {
    return {
      response: Response.json(
        { error: "Account deactivated", code: "account_deactivated" },
        { status: 403 },
      ),
    };
  }

  return {
    user: {
      id: user.id,
      email,
      name: user.name ?? "",
      role: profile.role,
      active: profile.active,
    },
  };
}

export async function requireRole(
  ...roles: Role[]
): Promise<{ user: AuthUser } | { response: Response }> {
  const result = await requireUser();
  if ("response" in result) {
    return result;
  }

  if (!roles.includes(result.user.role)) {
    return {
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return result;
}
