import { atom } from "jotai";

// Define atom for tracking the last log timestamp per project (for incremental log loading)
export const lastLogTimestampAtom = atom<Record<string, number>>({});
