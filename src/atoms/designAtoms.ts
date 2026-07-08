import { atom } from "jotai";
import type { DesignBriefData, DesignInterfaceData } from "@/ipc/types/design";

export interface DesignState {
  /** The committed design brief (colors, typography, screen list) per chat. */
  briefByChatId: Map<number, DesignBriefData>;
  /**
   * Generated interfaces per chat, keyed by interface id. A Map preserves
   * insertion order so screens render in the order they were designed, and a
   * re-emitted interface (same id) replaces the prior version in place.
   */
  interfacesByChatId: Map<number, Map<string, DesignInterfaceData>>;
}

export const designStateAtom = atom<DesignState>({
  briefByChatId: new Map(),
  interfacesByChatId: new Map(),
});
