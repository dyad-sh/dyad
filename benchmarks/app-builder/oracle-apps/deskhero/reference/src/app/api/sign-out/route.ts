import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";

// Neon Auth keeps two cookies: the session token and a signed, short-lived
// cache of the session payload (300s by default). Both have to go, or the
// cached copy keeps the server answering "signed in" for the rest of its TTL.
const SESSION_COOKIES = [
  "__Secure-neon-auth.session_token",
  "__Secure-neon-auth.local.session_data",
];

/**
 * Sign-out is a real form POST + redirect rather than a background fetch, so
 * the session is revoked and the cookies are cleared before the browser can be
 * anywhere else. A fetch-then-route sign-out loses the race with the next
 * navigation, which cancels the in-flight request and leaves a live session.
 */
export async function POST(request: Request) {
  await auth.signOut().catch(() => undefined);
  const response = NextResponse.redirect(
    new URL("/auth/sign-in", request.url),
    303,
  );
  for (const name of SESSION_COOKIES) {
    response.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    });
  }
  return response;
}
