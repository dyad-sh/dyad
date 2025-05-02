import { atom } from "jotai";

// Atom to track if any dropdown is currently open in the UI
export const dropdownOpenAtom = atom<boolean>(false);
