import { atomWithStorage } from "jotai/utils";

export const showTokenBarAtom = atomWithStorage<boolean>(
  "show-token-bar",
  false,
  undefined,
  { getOnInit: true },
);
