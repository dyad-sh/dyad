import { deleteCompany, getCompany, updateCompany } from "@/lib/queries";
import { optionalString, requiredString } from "@/lib/validate";
import { mutate, query, requireWrite } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  return query(request, async (ctx) => {
    const { id } = await params;
    const company = await getCompany(ctx.workspaceId, id);
    if (!company) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(company);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return mutate(request, async (ctx, body) => {
    requireWrite(ctx);
    const { id } = await params;

    const patch: { name?: string; domain?: string | null } = {};
    if (body.name !== undefined) patch.name = requiredString(body.name, "Name");
    if (body.domain !== undefined)
      patch.domain = optionalString(body.domain, "Domain");

    const company = await updateCompany(ctx.workspaceId, id, patch);
    if (!company) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(company);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return mutate(request, async (ctx) => {
    requireWrite(ctx);
    const { id } = await params;
    const ok = await deleteCompany(ctx.workspaceId, id);
    if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ success: true });
  });
}
