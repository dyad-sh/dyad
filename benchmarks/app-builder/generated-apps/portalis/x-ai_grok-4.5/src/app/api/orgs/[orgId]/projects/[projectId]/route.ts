import { requireOrgApiAccess, jsonError } from "@/lib/api-auth";
import {
  deleteProject,
  getProjectInOrg,
  updateProject,
} from "@/lib/projects";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ orgId: string; projectId: string }>;
};

export async function GET(_request: Request, { params }: RouteParams) {
  const { orgId, projectId } = await params;
  const result = await requireOrgApiAccess(orgId);
  if ("response" in result) {
    return result.response;
  }

  const project = await getProjectInOrg(orgId, projectId);
  if (!project) {
    return jsonError(404, "Not found");
  }

  return Response.json(project);
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { orgId, projectId } = await params;
  const result = await requireOrgApiAccess(orgId);
  if ("response" in result) {
    return result.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const payload =
    typeof body === "object" && body !== null
      ? (body as { name?: unknown; description?: unknown })
      : {};

  const input: { name?: string; description?: string } = {};
  if (typeof payload.name === "string") {
    input.name = payload.name;
  }
  if (typeof payload.description === "string") {
    input.description = payload.description;
  }

  const updated = await updateProject(
    orgId,
    projectId,
    input,
    result.ctx.user,
  );
  if (updated.notFound) {
    return jsonError(404, "Not found");
  }
  if (updated.error || !updated.project) {
    return jsonError(400, updated.error ?? "Failed to update project");
  }

  return Response.json(updated.project);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { orgId, projectId } = await params;
  const result = await requireOrgApiAccess(orgId, { admin: true });
  if ("response" in result) {
    return result.response;
  }

  const deleted = await deleteProject(orgId, projectId, result.ctx.user);
  if (deleted.notFound) {
    return jsonError(404, "Not found");
  }

  return Response.json({ ok: true });
}
