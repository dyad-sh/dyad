import { atom } from "jotai";
import { type LocalModel } from "@/ipc/ipc_types";

export const localModelsAtom = atom<LocalModel[]>([]);
export const localModelsLoadingAtom = atom<boolean>(false);
export const localModelsErrorAtom = atom<Error | null>(null);
