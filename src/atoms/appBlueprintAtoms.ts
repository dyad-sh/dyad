import { atom } from "jotai";
import type { AppBlueprintData } from "@/ipc/types/app_blueprint";

export interface AppBlueprintState {
  plansByChatId: Map<number, AppBlueprintData>;
  approvedChatIds: Set<number>;
  visualsReadyChatIds: Set<number>;
  timedOutChatIds: Set<number>;
}

export const appBlueprintStateAtom = atom<AppBlueprintState>({
  plansByChatId: new Map(),
  approvedChatIds: new Set<number>(),
  visualsReadyChatIds: new Set<number>(),
  timedOutChatIds: new Set<number>(),
});
