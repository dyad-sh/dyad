import { auth } from "@/lib/auth/server";

export default auth.middleware({
  loginUrl: "/auth/sign-in",
});

export const config = {
  matcher: [
    "/tickets",
    "/tickets/(.*)",
    "/admin",
    "/admin/(.*)",
    "/agent",
    "/agent/(.*)",
  ],
};
