import { atom } from "jotai";

/**
 * Atom to store the number of active checkoutVersion mutations.
 * This is a "primitive" atom that you will update directly.
 */
export const activeCheckoutCounterAtom = atom(0);

/**
 * Derived atom that is true if any checkoutVersion mutation is in progress.
 * This atom is read-only and derives its state from activeCheckoutCounterAtom.
 */
export const isAnyCheckoutVersionInProgressAtom = atom(
  (get) => get(activeCheckoutCounterAtom) > 0,
);
