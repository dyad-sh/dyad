import { authorize } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await authorize();
  if (!gate.ok) return gate.response;
  const { user } = gate;

  return Response.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    active: user.active,
  });
}
