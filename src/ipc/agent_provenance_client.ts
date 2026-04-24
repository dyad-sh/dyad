/**
 * Agent Provenance & Reputation IPC Client (renderer-side) — Tier 4.
 */

import type { IpcRenderer } from "electron";
import type {
  ProvenanceCurrency,
  ProvenanceEventRow,
  ProvenanceKind,
  ReputationScoreRow,
  SlashRecordRow,
  SlashStatus,
} from "@/db/agent_provenance_schema";

export interface EmitEventInput {
  kind: ProvenanceKind;
  principalDid: string;
  subjectRef?: string | null;
  payload?: Record<string, unknown> | null;
  issuerDid?: string;
  privateKeyHex?: string;
  algorithm?: "ed25519" | "secp256k1";
}

export interface EventFilters {
  principalDid?: string;
  kind?: ProvenanceKind | ProvenanceKind[];
  subjectRef?: string;
  limit?: number;
}

export interface ScoreFilters {
  minSuccessRate?: number;
  limit?: number;
}

export interface ProposeSlashInput {
  principalDid: string;
  reason: string;
  amount?: string;
  currency?: ProvenanceCurrency;
  contractId?: string;
  evidence?: Record<string, unknown> | null;
  createdBy?: string;
}

export interface SlashFilters {
  principalDid?: string;
  status?: SlashStatus;
  limit?: number;
}

type ElectronWindow = Window & {
  electron?: { ipcRenderer?: IpcRenderer };
};

class AgentProvenanceClientImpl {
  private static instance: AgentProvenanceClientImpl | undefined;
  private readonly ipcRenderer: IpcRenderer;

  private constructor() {
    const w = window as unknown as ElectronWindow;
    const renderer = w.electron?.ipcRenderer;
    if (!renderer)
      throw new Error(
        "AgentProvenanceClient: window.electron.ipcRenderer is not available",
      );
    this.ipcRenderer = renderer;
  }

  static getInstance(): AgentProvenanceClientImpl {
    if (!AgentProvenanceClientImpl.instance) {
      AgentProvenanceClientImpl.instance = new AgentProvenanceClientImpl();
    }
    return AgentProvenanceClientImpl.instance;
  }

  emitEvent(input: EmitEventInput): Promise<ProvenanceEventRow> {
    return this.ipcRenderer.invoke("provenance:event:emit", input);
  }

  pinEvent(id: string): Promise<ProvenanceEventRow> {
    return this.ipcRenderer.invoke("provenance:event:pin", { id });
  }

  listEvents(filters: EventFilters = {}): Promise<ProvenanceEventRow[]> {
    return this.ipcRenderer.invoke("provenance:event:list", filters);
  }

  getEvent(id: string): Promise<ProvenanceEventRow | null> {
    return this.ipcRenderer.invoke("provenance:event:get", { id });
  }

  recomputeScore(principalDid: string): Promise<ReputationScoreRow> {
    return this.ipcRenderer.invoke("provenance:score:recompute", {
      principalDid,
    });
  }

  getScore(principalDid: string): Promise<ReputationScoreRow | null> {
    return this.ipcRenderer.invoke("provenance:score:get", { principalDid });
  }

  listScores(filters: ScoreFilters = {}): Promise<ReputationScoreRow[]> {
    return this.ipcRenderer.invoke("provenance:score:list", filters);
  }

  proposeSlash(input: ProposeSlashInput): Promise<SlashRecordRow> {
    return this.ipcRenderer.invoke("provenance:slash:propose", input);
  }

  activateSlash(id: string): Promise<SlashRecordRow> {
    return this.ipcRenderer.invoke("provenance:slash:activate", { id });
  }

  reverseSlash(params: { id: string; reason: string }): Promise<SlashRecordRow> {
    return this.ipcRenderer.invoke("provenance:slash:reverse", params);
  }

  listSlashes(filters: SlashFilters = {}): Promise<SlashRecordRow[]> {
    return this.ipcRenderer.invoke("provenance:slash:list", filters);
  }
}

export const AgentProvenanceClient = AgentProvenanceClientImpl;
