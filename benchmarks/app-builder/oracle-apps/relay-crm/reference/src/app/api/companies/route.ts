import { createCompany, listCompanies } from "@/lib/queries";
import { optionalString, requiredString } from "@/lib/validate";
import { mutate, query, requireWrite } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return query(request, async (ctx) =>
    Response.json(await listCompanies(ctx.workspaceId)),
  );
}

export async function POST(request: Request) {
  return mutate(request, async (ctx, body) => {
    requireWrite(ctx);
    const company = await createCompany(ctx.workspaceId, ctx.user.id, {
      name: requiredString(body.name, "Name"),
      domain: optionalString(body.domain, "Domain"),
    });
    return Response.json(company, { status: 201 });
  });
}
