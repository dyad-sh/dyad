import { query } from "@/lib/context";

export const dynamic = "force-dynamic";

/** The caller's own identity, active book and memberships — nobody else's. */
export async function GET(request: Request) {
  return query(request, async (ctx) =>
    Response.json({
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      activeBookId: ctx.bookId,
      memberships: ctx.memberships.map((m) => ({
        bookId: m.bookId,
        bookName: m.bookName,
        membershipId: m.membershipId,
        role: m.role,
      })),
    }),
  );
}
