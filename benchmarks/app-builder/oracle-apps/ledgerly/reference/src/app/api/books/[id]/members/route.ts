import { addMember, listMembers, MEMBER_ROLES } from "@/lib/books";
import { mutateBook, queryBook, requireOwner } from "@/lib/context";
import { enumValue, requiredString } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return queryBook(id, async (ctx) =>
    Response.json(await listMembers(ctx.bookId)),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return mutateBook(request, id, async (ctx, body) => {
    // Both roles manage accounts and entries; only an owner adds members.
    requireOwner(ctx);
    const member = await addMember(
      ctx.bookId,
      requiredString(body.email, "Email"),
      body.role === undefined
        ? "bookkeeper"
        : enumValue(body.role, MEMBER_ROLES, "Role"),
    );
    return Response.json(member, { status: 201 });
  });
}
