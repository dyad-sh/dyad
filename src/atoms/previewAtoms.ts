import { ComponentSelection } from "@/ipc/ipc_types";
import { atom } from "jotai";

export const selectedComponentsPreviewAtom = atom<ComponentSelection[]>([]);

export const previewIframeRefAtom = atom<HTMLIFrameElement | null>(null);
