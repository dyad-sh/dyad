import { cookies } from "next/headers";

/**
 * Per-client read-your-writes barrier.
 *
 * A browser can fire a mutating request and navigate in the same tick — the
 * kanban stage `<select>` and the delete confirmation both do, and so does a
 * user who clicks "save" and immediately hits reload. The mutation still
 * reaches the server (the request is on the wire before the navigation
 * starts), but the render that the navigation triggers may begin before the
 * write commits, and would then paint stale data that "un-does" what the user
 * just did on screen.
 *
 * Two guarantees, both scoped to one client (keyed on its session cookies) so
 * unrelated users never wait on each other:
 *
 *  - `serializeWrite` runs one client's mutations in submission order. Without
 *    it, "create a contact" and "switch workspace" fired back to back can
 *    interleave and file the contact in the wrong workspace.
 *  - `awaitWrites` makes a read wait for that client's in-flight mutations, so
 *    a page render or list endpoint never observes a state older than the
 *    request the same client already sent.
 *
 * This is process-local coordination only: correctness (tenancy, roles,
 * ownership) is still enforced by the SQL predicates in every query.
 */

/** A stuck write must never wedge a client forever. */
const MAX_WAIT_MS = 20_000;

/** Tail of each client's write chain; resolves when that write finishes. */
const chains = new Map<string, Promise<void>>();

async function clientKey(): Promise<string> {
  try {
    const store = await cookies();
    const key = store
      .getAll()
      .map((c) => `${c.name}=${c.value}`)
      .sort()
      .join("|");
    return key || "anonymous";
  } catch {
    return "anonymous";
  }
}

function withTimeout(promise: Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, MAX_WAIT_MS);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/** Runs `fn` after this client's earlier writes have finished. */
export async function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
  const key = await clientKey();
  const previous = chains.get(key);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mine = previous ? previous.then(() => gate) : gate;
  chains.set(key, mine);

  if (previous) await withTimeout(previous);
  try {
    return await fn();
  } finally {
    release();
    // Drop the entry once this write is the last one in the chain.
    if (chains.get(key) === mine) chains.delete(key);
  }
}

/** Waits for this client's in-flight writes before reading. */
export async function awaitWrites(): Promise<void> {
  const key = await clientKey();
  const pending = chains.get(key);
  if (pending) await withTimeout(pending);
}
