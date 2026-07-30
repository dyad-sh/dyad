import { auth } from "@/lib/auth/server";

export default auth.middleware({
  loginUrl: "/auth/sign-in",
});

export const config = {
  matcher: [
    "/contacts",
    "/contacts/:path*",
    "/companies",
    "/companies/:path*",
    "/deals",
    "/deals/:path*",
    "/workspaces",
    "/workspaces/:path*",
    "/settings/:path*",
    "/invites",
    "/invites/:path*",
  ],
};
