/**
 * User context for IPC handlers.
 *
 * Uses AsyncLocalStorage so handlers can call getCurrentUser() without
 * needing their signatures changed — the Express auth middleware sets the
 * context once per request and it propagates through the entire call chain.
 *
 * In Electron mode this store is never populated, so getCurrentUser() returns
 * undefined and handlers fall back to single-user behaviour (no userId filter).
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface UserContext {
  userId: string;
  email: string;
  role: "user" | "admin";
  plan: "free" | "pro";
}

const storage = new AsyncLocalStorage<UserContext>();

/**
 * Run `fn` with the given user context bound to the current async scope.
 * Called by the Express auth middleware for every authenticated request.
 */
export function runWithUserContext<T>(context: UserContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Returns the user context for the current async scope, or undefined if
 * running in Electron mode (no auth middleware) or on an unauthenticated route.
 */
export function getCurrentUser(): UserContext | undefined {
  return storage.getStore();
}

/**
 * Like getCurrentUser() but throws if there is no user context.
 * Use in handlers that must only be called when authenticated.
 */
export function requireCurrentUser(): UserContext {
  const user = storage.getStore();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}
