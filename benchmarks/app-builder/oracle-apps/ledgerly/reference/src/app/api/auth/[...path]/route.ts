import { auth } from "@/lib/auth/server";

// The managed auth service's own endpoints, mounted under the app so the
// browser client and the server session helper share an origin (and a cookie).
export const { GET, POST } = auth.handler();
