import { auth } from "@/lib/auth/server";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export async function getSessionUser(): Promise<AuthUser | null> {
  const { data: session } = await auth.getSession();
  if (!session?.user?.id) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
  };
}

export async function requireSessionUser(): Promise<AuthUser | Response> {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return user;
}
