export type ClockHandle = ReturnType<typeof setTimeout>;

/** Injectable wall clock and scheduler for state-machine command adapters. */
export interface Clock {
  now(): number;
  schedule(callback: () => void, delayMs: number): ClockHandle;
  cancel(handle: ClockHandle): void;
}

/** Injectable source for kind-prefixed operation identities. */
export interface IdSource {
  next(prefix: string): string;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle),
};

export const uuidIdSource: IdSource = {
  next: (prefix) => `${prefix}:${globalThis.crypto.randomUUID()}`,
};
