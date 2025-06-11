import { ComponentSelection } from "@/ipc/ipc_types";
import { atom } from "jotai";

export const selectedComponentPreviewAtom = atom<ComponentSelection | null>(
  null,
);
