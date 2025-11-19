import { ComponentSelection } from "@/ipc/ipc_types";
import { atom } from "jotai";

export const selectedComponentsPreviewAtom = atom<ComponentSelection[]>([]);

export const visualEditingSelectedComponentAtom =
  atom<ComponentSelection | null>(null);

export const previewIframeRefAtom = atom<HTMLIFrameElement | null>(null);
