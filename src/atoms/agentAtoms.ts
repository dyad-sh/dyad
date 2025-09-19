import { atom } from "jotai";
import type { AgentWorkflow } from "@/agents/dayd/types";

export const agentWorkflowAtom = atom<AgentWorkflow | null>(null);
export const agentWorkflowLoadingAtom = atom<boolean>(false);
export const agentWorkflowErrorAtom = atom<string | null>(null);
