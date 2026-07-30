import { NextRequest, NextResponse } from "next/server";
import { getOrgIdForActiveApiKey } from "@/lib/apikeys";
import { getProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const key = match?.[1]?.trim();

  if (!key) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = await getOrgIdForActiveApiKey(key);
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects = await getProjects(orgId);

  return NextResponse.json(
    projects.map((project) => ({
      id: project.id,
      name: project.name,
    })),
  );
}
