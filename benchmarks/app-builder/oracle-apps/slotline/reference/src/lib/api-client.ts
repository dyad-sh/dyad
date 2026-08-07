"use client";

/**
 * The one client-side call into the JSON API.
 *
 * Every mutation the UI performs goes through a pinned API route rather than a
 * bespoke server action, so there is exactly one authorization path per
 * resource and the browser can never reach the database. `keepalive` keeps a
 * request alive across the navigation that usually follows it, and the caller
 * always awaits the response before routing.
 */
export async function apiFetch(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<{ ok: boolean; status: number; data: any; error: string }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method,
      headers: init.body === undefined ? undefined : {
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      keepalive: true,
    });
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "The clinic could not be reached. Please try again.",
    };
  }
  let data: any = null;
  if (response.status !== 204) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok
      ? ""
      : typeof data?.error === "string" && data.error
        ? data.error
        : "Something went wrong. Please try again.",
  };
}
