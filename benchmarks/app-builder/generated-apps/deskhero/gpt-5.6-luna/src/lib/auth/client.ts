'use client';

import { createAuthClient } from "@neondatabase/auth/next";

export const authClient = createAuthClient();

export type SessionState = {
  data: { user: { id: string; name: string; email: string } } | null;
  isPending: boolean;
};

export const useAuthSession = (): SessionState =>
  (authClient.useSession as unknown as () => SessionState)();
