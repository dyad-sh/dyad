import { requireUser } from "@/lib/current-user";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  return Response.json(auth.user);
}
