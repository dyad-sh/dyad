import { atom } from "jotai";
import type {
  DesignBriefData,
  DesignInterfaceData,
  DesignOptionsData,
} from "@/ipc/types/design";

export interface DesignState {
  /** The committed design brief (colors, typography, screen list) per chat. */
  briefByChatId: Map<number, DesignBriefData>;
  /**
   * The options step awaiting a choice, per chat. The agent is blocked on the
   * user's pick while an entry is present; it's cleared once they respond.
   */
  pendingOptionsByChatId: Map<number, DesignOptionsData>;
  /**
   * Generated interfaces per chat, keyed by interface id. A Map preserves
   * insertion order so screens render in the order they were designed, and a
   * re-emitted interface (same id) replaces the prior version in place.
   */
  interfacesByChatId: Map<number, Map<string, DesignInterfaceData>>;
}

export const designStateAtom = atom<DesignState>({
  briefByChatId: new Map(),
  pendingOptionsByChatId: new Map(),
  interfacesByChatId: new Map(),
});
