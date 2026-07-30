import { requireOrgApiAccess, jsonError } from "@/lib/api-auth";
import { createProject, listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ orgId: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { orgId } = await params;
  const result = await requireOrgApiAccess(orgId);
  if ("response" in result) {
    return result.response;
  }

  const projects = await listProjects(orgId);
  return Response.json(projects);
}

export async function POST(request: Request, { params }: RouteParams) {
  const { orgId } = await params;
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

  const name =
    typeof body === "object" &&
    body !== null &&
    "name" in body &&
    typeof (body as { name: unknown }).name === "string"
      ? (body as { name: string }).name
      : "";
  const description =
    typeof body === "object" &&
    body !== null &&
    "description" in body &&
    typeof (body as { description: unknown }).description === "string"
      ? (body as { description: string }).description
      : "";

  const created = await createProject(
    orgId,
    { name, description },
    result.ctx.user,
  );
  if (created.error || !created.project) {
    return jsonError(400, created.error ?? "Failed to create project");
  }

  return Response.json(created.project, { status: 201 });
}
