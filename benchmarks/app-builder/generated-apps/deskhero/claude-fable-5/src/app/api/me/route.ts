import { requireActiveUser } from "@/lib/roles";

export async function GET() {
  const { ctx, response } = await requireActiveUser();
  if (!ctx) return response;
  const { id, email, name } = ctx.user;
  return Response.json({ id, email, name, role: ctx.role });
}
