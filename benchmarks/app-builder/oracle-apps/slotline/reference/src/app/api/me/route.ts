import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The caller's own identity and role — never anybody else's. */
export async function GET() {
  return route(async ({ user, role }) =>
    Response.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role,
    }),
  );
}
