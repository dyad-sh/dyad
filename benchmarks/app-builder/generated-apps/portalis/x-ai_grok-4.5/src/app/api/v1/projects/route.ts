import { jsonError } from "@/lib/api-auth";
import { authenticateApiKey } from "@/lib/api-keys";
import { listProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

function extractBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function GET(request: Request) {
  const token = extractBearer(request);
  if (!token) {
    return jsonError(401, "Unauthorized");
  }

  const auth = await authenticateApiKey(token);
  if (!auth) {
    // Missing, invalid, or revoked keys all return 401
    return jsonError(401, "Unauthorized");
  }

  const projects = await listProjects(auth.orgId);
  return Response.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    })),
  );
}
