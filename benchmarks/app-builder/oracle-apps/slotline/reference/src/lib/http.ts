import { sessionUser, type SessionUser } from "@/lib/auth/server";
import { roleOf, type Role } from "@/lib/roles";
import { ForbiddenError, ValidationError } from "@/lib/validate";

/**
 * One entry point for every JSON route handler.
 *
 * It reads the session, denies the anonymous caller with 401 and no data,
 * resolves the caller's own role, and turns any thrown domain error into the
 * pinned `{ "error": "<message>" }` body. Nothing else in the app builds an
 * error response, so a stack trace or a SQL string can never reach a client.
 */

export interface RouteContext {
  user: SessionUser;
  role: Role;
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export const unauthorized = () =>
  jsonError("You must be signed in to do that.", 401);

/** The single staff gate every staff-only handler funnels through. */
export function requireStaff(ctx: RouteContext): void {
  if (ctx.role !== "staff") {
    throw new ForbiddenError("Only clinic staff may do that.");
  }
}

/** Postgres error codes this app answers deliberately rather than as a 500. */
function postgresError(error: unknown): Response | null {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "23P01": // exclusion_violation — the no-overlap guarantee fired.
      return jsonError("That time has just been taken.", 409);
    case "23505": // unique_violation
      return jsonError("That record already exists.", 409);
    case "23503": // foreign_key_violation
      return jsonError("That record is still referenced by a booking.", 409);
    case "23514": // check_violation
      return jsonError("That value is not allowed.", 400);
    default:
      return null;
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ValidationError) {
    return jsonError(error.message, error.status);
  }
  const mapped = postgresError(error);
  if (mapped) return mapped;
  console.error("[slotline] unhandled route error", error);
  return jsonError("Something went wrong. Please try again.", 500);
}

export async function route(
  handler: (ctx: RouteContext) => Promise<Response>,
): Promise<Response> {
  const user = await sessionUser();
  if (!user) return unauthorized();
  try {
    return await handler({ user, role: await roleOf(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Parse a JSON body without ever throwing; a malformed body is an empty one. */
export async function readJson(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
