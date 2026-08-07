/**
 * The one way this app refuses a request.
 *
 * Every route handler runs inside `handle()`, so an authorization or validation
 * failure is raised where it is detected — before any write — and turned into
 * the exact status the milestone prompts pin (401 no session, 403 wrong actor,
 * 404 no such record, 409 illegal state change, 400 bad body) with a JSON
 * `{ "error": "<message>" }` body that never carries record data.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = () =>
  new HttpError(401, "Sign in to continue.");
export const forbidden = (message = "You do not have access to this.") =>
  new HttpError(403, message);
export const notFound = (message = "Not found.") =>
  new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const badRequest = (message: string) => new HttpError(400, message);

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("[curbside] unhandled route error", error);
  return Response.json({ error: "Something went wrong." }, { status: 500 });
}

/** Wraps a route handler so every refusal becomes its pinned status code. */
export async function handle(
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    return errorResponse(error);
  }
}

/** Parses an optional JSON body; an absent body is an empty object. */
export async function readBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const raw = await request.text().catch(() => "");
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}
