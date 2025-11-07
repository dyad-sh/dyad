import { ComponentSelection } from "@/ipc/ipc_types";
import { atom } from "jotai";

export const selectedComponentPreviewAtom = atom<ComponentSelection[]>([]);

export const previewIframeRefAtom = atom<HTMLIFrameElement | null>(null);
