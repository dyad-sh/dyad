import { requireUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await requireUser();
  if ("response" in result) {
    return result.response;
  }

  const { user } = result;
  return Response.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
  });
}
