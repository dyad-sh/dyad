import { atom } from "jotai";
import type { MiniPlanData } from "@/ipc/types/mini_plan";

export interface MiniPlanState {
  plansByChatId: Map<number, MiniPlanData>;
  approvedChatIds: Set<number>;
  visualsReadyChatIds: Set<number>;
}

export const miniPlanStateAtom = atom<MiniPlanState>({
  plansByChatId: new Map(),
  approvedChatIds: new Set<number>(),
  visualsReadyChatIds: new Set<number>(),
});
