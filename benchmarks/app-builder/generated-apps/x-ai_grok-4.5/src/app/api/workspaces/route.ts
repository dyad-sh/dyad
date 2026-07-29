import { requireSessionUser } from "@/lib/auth/session";
import { clampString, sanitizeWriteBody } from "@/lib/validation";
import { createWorkspace, ensureUserWorkspace, listMemberships } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  await ensureUserWorkspace(user);
  const memberships = await listMemberships(user.id);

  const workspaces = memberships.map((m) => ({
    id: m.workspaceId,
    name: m.workspaceName,
  }));

  return Response.json(workspaces);
}

export async function POST(request: Request) {
  const user = await requireSessionUser();
  if (user instanceof Response) return user;

  let body: Record<string, unknown>;
  try {
    body = sanitizeWriteBody(await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = clampString(body.name, "Name", { required: true });
  if (name instanceof Response) return name;

  const workspace = await createWorkspace(user, name);
  return Response.json(workspace, { status: 201 });
}
