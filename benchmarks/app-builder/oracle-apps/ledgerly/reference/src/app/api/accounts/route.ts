import { createAccount, listAccounts, parseAccountInput } from "@/lib/accounts";
import { mutate, query } from "@/lib/context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return query(request, async (ctx) =>
    Response.json(await listAccounts(ctx.bookId)),
  );
}

export async function POST(request: Request) {
  return mutate(request, async (ctx, body) => {
    const account = await createAccount(ctx.bookId, parseAccountInput(body));
    return Response.json(account, { status: 201 });
  });
}
