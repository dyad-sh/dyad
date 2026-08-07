import { auth } from "@/lib/auth/server";

/** The managed auth service's own endpoints (sign-up, sign-in, sign-out). */
export const { GET, POST } = auth.handler();
