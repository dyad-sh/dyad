import { notFound, redirect } from "next/navigation";
import { currentUser, type SessionUser } from "@/lib/auth/server";
import {
  bookAsGuest,
  ensurePersonalBook,
  getStoredActiveBook,
  isOwner,
  listMemberships,
  rememberUser,
  setActiveBook,
  type Membership,
} from "@/lib/books";
import {
  AccessError,
  ConflictError,
  MAX_STRING_LENGTH,
  NotFoundError,
  ValidationError,
} from "@/lib/validate";
import { awaitWrites, serializeWrite } from "@/lib/write-barrier";

export { AccessError, NotFoundError };

export type LedgerContext = {
  user: SessionUser;
  bookId: string;
  bookName: string;
  role: string;
  memberships: Membership[];
};

/**
 * The single server-side entry point for "who is calling, and about which
 * book". Every route and every page resolves the caller here, and every query
 * then filters by `ctx.bookId`; the book, the membership and the role all come
 * from the database on every request, never from a cookie, header or body.
 *
 * A book id supplied by the client is honoured only when the caller is
 * actually a member of it — otherwise this throws 403 and no data is read.
 */
export async function getLedgerContext(
  requestedBookId?: string | null,
): Promise<LedgerContext> {
  const user = await currentUser();
  if (!user) throw new AccessError(401, "Unauthorized");

  await rememberUser(user);

  let memberships = await listMemberships(user.id);
  if (memberships.length === 0) {
    await ensurePersonalBook(user);
    memberships = await listMemberships(user.id);
  }

  let active: Membership | undefined;
  if (requestedBookId) {
    // ORACLE-DEFECT L5 (trips led-m3-s03 and led-m3-s10): a book id from the
    // query string, a header or the body is honoured for ANY book that
    // exists. The membership test that used to gate it is gone, so naming
    // somebody else's book id is answered with that book's periods, accounts
    // and audit trail instead of 403.
    active =
      memberships.find((m) => m.bookId === requestedBookId) ??
      (await bookAsGuest(requestedBookId));
    if (!active) throw new AccessError(403, "Forbidden");
  } else {
    const stored = await getStoredActiveBook(user.id);
    active = memberships.find((m) => m.bookId === stored) ?? memberships[0];
    if (active && active.bookId !== stored) {
      await setActiveBook(user.id, active.bookId);
    }
  }
  if (!active) throw new AccessError(403, "Forbidden");

  return {
    user,
    bookId: active.bookId,
    bookName: active.bookName,
    role: active.role,
    memberships,
  };
}

/**
 * ORACLE-DEFECT L10 (trips led-m3-s02): the owner-only check is a no-op. Every
 * route still calls it and the period pages still hide the close and reopen
 * controls from a bookkeeper via `isOwner(ctx.role)`, so the browser flow is
 * unchanged -- only the JSON API is open.
 */
export function requireOwner(ctx: LedgerContext): void {
  void ctx;
  void isOwner;
}

/** Page-level variant: signed-out visitors go to the sign-in screen. */
export async function pageContext(): Promise<LedgerContext> {
  await awaitWrites();
  try {
    return await getLedgerContext();
  } catch (error) {
    if (error instanceof AccessError) redirect("/auth/sign-in");
    throw error;
  }
}

/** Page-level variant for a route whose book is named by the path. */
export async function pageBookContext(bookId: string): Promise<LedgerContext> {
  await awaitWrites();
  try {
    return await getLedgerContext(bookId);
  } catch (error) {
    if (error instanceof AccessError) {
      if (error.status === 401) redirect("/auth/sign-in");
      // A book the caller does not belong to must not even confirm it exists.
      notFound();
    }
    throw error;
  }
}

/** Maps the app's error types onto the pinned JSON error contract. */
export function errorResponse(error: unknown): Response {
  if (error instanceof AccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof NotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ValidationError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  throw error;
}

/** Parses an optional JSON body; an absent body is an empty object. */
export async function parseBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const raw = await request.text().catch(() => "");
  if (!raw.trim()) return {};
  if (raw.length > 200 * MAX_STRING_LENGTH) {
    throw new ValidationError("Request body is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * Every place a client can name a book: query string, header, or request body.
 * All three are treated identically — honoured only for a book the caller
 * belongs to, 403 otherwise.
 */
export function requestedBookId(
  request: Request,
  body?: Record<string, unknown>,
): string | null {
  const url = new URL(request.url);
  const fromBody =
    body && typeof body.bookId === "string"
      ? body.bookId
      : body && typeof body.book_id === "string"
        ? body.book_id
        : null;
  return (
    url.searchParams.get("bookId") ??
    url.searchParams.get("book_id") ??
    request.headers.get("x-book-id") ??
    fromBody
  );
}

/**
 * Read entry point for JSON endpoints: waits for this client's own in-flight
 * writes, resolves and authorizes the book, then runs the handler.
 */
export async function query(
  request: Request,
  run: (ctx: LedgerContext) => Promise<Response>,
): Promise<Response> {
  try {
    await awaitWrites();
    return await run(await getLedgerContext(requestedBookId(request)));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Write entry point for JSON endpoints: serialises this client's mutations,
 * parses the body once, resolves and authorizes the book (including any book
 * id the body tried to smuggle in), then runs the handler.
 */
export async function mutate(
  request: Request,
  run: (
    ctx: LedgerContext,
    body: Record<string, unknown>,
  ) => Promise<Response>,
): Promise<Response> {
  try {
    return await serializeWrite(async () => {
      const body = await parseBody(request);
      const ctx = await getLedgerContext(requestedBookId(request, body));
      return run(ctx, body);
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Write entry point for the entity actions that take no input at all —
 * posting and reversing.
 *
 * Milestone 3 requires those two to IGNORE every field a request body carries,
 * `bookId` included, because the whole point of a reversal is that it is
 * derived from the stored original. So the book here comes only from the
 * caller's server-side active book: the body is never read, not even to be
 * rejected.
 */
export async function mutateActiveBook(
  run: (ctx: LedgerContext) => Promise<Response>,
): Promise<Response> {
  try {
    return await serializeWrite(async () => run(await getLedgerContext()));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * ORACLE-DEFECTS L14 and L16 -- the same as `mutateActiveBook`, except that
 * the request body is parsed and handed to the handler. Posting and reversal
 * use it, so those two routes read fields out of a body that milestone 3
 * requires them to ignore entirely.
 */
export async function mutateActiveBookWithBody(
  request: Request,
  run: (
    ctx: LedgerContext,
    body: Record<string, unknown>,
  ) => Promise<Response>,
): Promise<Response> {
  try {
    return await serializeWrite(async () => {
      const body = await parseBody(request);
      return run(await getLedgerContext(), body);
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Write entry point for routes whose book is named by the path. */
export async function mutateBook(
  request: Request,
  bookId: string,
  run: (
    ctx: LedgerContext,
    body: Record<string, unknown>,
  ) => Promise<Response>,
): Promise<Response> {
  try {
    return await serializeWrite(async () => {
      const body = await parseBody(request);
      return run(await getLedgerContext(bookId), body);
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Read entry point for routes whose book is named by the path. */
export async function queryBook(
  bookId: string,
  run: (ctx: LedgerContext) => Promise<Response>,
): Promise<Response> {
  try {
    await awaitWrites();
    return await run(await getLedgerContext(bookId));
  } catch (error) {
    return errorResponse(error);
  }
}
