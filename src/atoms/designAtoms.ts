import { atom } from "jotai";
import type { DesignSpec } from "@/ipc/types/design";

export interface DesignState {
  /** The latest design spec per chat, keyed by chatId. */
  specsByChatId: Map<number, DesignSpec>;
}

export const designStateAtom = atom<DesignState>({
  specsByChatId: new Map(),
});

/**
 * Interface ids (keyed by chatId) currently being regenerated, so the Design
 * panel can show a per-card spinner until the next design:update arrives.
 */
export const regeneratingInterfacesAtom = atom<Map<number, Set<string>>>(
  new Map(),
);

export function setDesignSpec(
  prev: DesignState,
  chatId: number,
  spec: DesignSpec,
): DesignState {
  const next = new Map(prev.specsByChatId);
  next.set(chatId, spec);
  return { ...prev, specsByChatId: next };
}
