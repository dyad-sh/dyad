/**
 * SSI IPC Client
 *
 * Renderer-side client for Self-Sovereign Identity operations.
 * Communicates with the main process via Electron IPC.
 */

import type { IpcRenderer } from "electron";

import type {
  DIDString,
  DIDDocument,
  SSIIdentity,
  SSIIdentityCreateParams,
  SSIIdentityUpdateParams,
  SSICredentialIssueParams,
  SSICredentialListParams,
  SSIPresentationCreateParams,
  SSIAnchorHistoryParams,
  SSICredentialVerifyResult,
  SSIPresentationVerifyResult,
  VerifiableCredential,
  VerifiablePresentation,
  CelestiaAnchor,
  StoredCredential,
  StoredAnchor,
  IdentityType,
  DIDEvent,
} from "../types/ssi_types";

export class SsiClient {
  private static instance: SsiClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  public static getInstance(): SsiClient {
    if (!SsiClient.instance) {
      SsiClient.instance = new SsiClient();
    }
    return SsiClient.instance;
  }

  // ─── Identity ─────────────────────────────────────────────────────

  async createIdentity(
    params: SSIIdentityCreateParams,
  ): Promise<{ identity: SSIIdentity; anchor: CelestiaAnchor | null }> {
    return this.ipcRenderer.invoke("ssi:identity:create", params);
  }

  async getIdentity(did?: DIDString): Promise<SSIIdentity | null> {
    return this.ipcRenderer.invoke("ssi:identity:get", did);
  }

  async listIdentities(type?: IdentityType): Promise<SSIIdentity[]> {
    return this.ipcRenderer.invoke("ssi:identity:list", type);
  }

  async updateIdentity(params: SSIIdentityUpdateParams): Promise<SSIIdentity> {
    return this.ipcRenderer.invoke("ssi:identity:update", params);
  }

  async deactivateIdentity(did: DIDString): Promise<void> {
    return this.ipcRenderer.invoke("ssi:identity:deactivate", did);
  }

  async resolveDID(did: DIDString): Promise<DIDDocument> {
    return this.ipcRenderer.invoke("ssi:identity:resolve", did);
  }

  async linkIdentity(params: {
    primaryDid: DIDString;
    linkedDid: DIDString;
    linkedType: IdentityType;
    linkedPublicKey: string;
    algorithm: "ed25519" | "secp256k1";
  }): Promise<SSIIdentity> {
    return this.ipcRenderer.invoke("ssi:identity:link", params);
  }

  // ─── Credentials ──────────────────────────────────────────────────

  async issueCredential(
    params: SSICredentialIssueParams & { issuerDid: DIDString },
  ): Promise<VerifiableCredential> {
    return this.ipcRenderer.invoke("ssi:credential:issue", params);
  }

  async verifyCredential(
    credential: VerifiableCredential,
  ): Promise<SSICredentialVerifyResult> {
    return this.ipcRenderer.invoke("ssi:credential:verify", credential);
  }

  async listCredentials(
    params?: SSICredentialListParams,
  ): Promise<StoredCredential[]> {
    return this.ipcRenderer.invoke("ssi:credential:list", params);
  }

  async getCredential(credentialId: string): Promise<VerifiableCredential> {
    return this.ipcRenderer.invoke("ssi:credential:get", credentialId);
  }

  async revokeCredential(
    credentialId: string,
    issuerDid: DIDString,
  ): Promise<void> {
    return this.ipcRenderer.invoke("ssi:credential:revoke", {
      credentialId,
      issuerDid,
    });
  }

  async importCredential(credential: VerifiableCredential): Promise<void> {
    return this.ipcRenderer.invoke("ssi:credential:import", credential);
  }

  async exportCredential(credentialId: string): Promise<VerifiableCredential> {
    return this.ipcRenderer.invoke("ssi:credential:export", credentialId);
  }

  // ─── Presentations ───────────────────────────────────────────────

  async createPresentation(
    params: SSIPresentationCreateParams & { holderDid: DIDString },
  ): Promise<VerifiablePresentation> {
    return this.ipcRenderer.invoke("ssi:presentation:create", params);
  }

  async verifyPresentation(
    presentation: VerifiablePresentation,
  ): Promise<SSIPresentationVerifyResult> {
    return this.ipcRenderer.invoke("ssi:presentation:verify", presentation);
  }

  async listPresentations(holderDid?: DIDString): Promise<any[]> {
    return this.ipcRenderer.invoke("ssi:presentation:list", holderDid);
  }

  // ─── Anchoring ────────────────────────────────────────────────────

  async submitAnchor(event: DIDEvent): Promise<CelestiaAnchor> {
    return this.ipcRenderer.invoke("ssi:anchor:submit", event);
  }

  async verifyAnchor(anchor: {
    contentHash: string;
    height: number;
    namespace: string;
    anchoredAt: string;
  }): Promise<{ valid: boolean; timestamp?: string }> {
    return this.ipcRenderer.invoke("ssi:anchor:verify", anchor);
  }

  async getAnchorHistory(params: SSIAnchorHistoryParams): Promise<StoredAnchor[]> {
    return this.ipcRenderer.invoke("ssi:anchor:history", params);
  }
}
