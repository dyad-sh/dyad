import { atom } from "jotai";
import type { ProposalResult } from "@/lib/schemas";

export const proposalResultAtom = atom<ProposalResult | null>(null);
