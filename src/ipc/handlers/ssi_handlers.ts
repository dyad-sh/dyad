/**
 * SSI IPC Handlers
 *
 * Registers Electron IPC handlers for all Self-Sovereign Identity operations:
 * identity CRUD, credential management, presentations, and Celestia anchoring.
 */

import { ipcMain } from "electron";
import * as crypto from "crypto";
import { didDocumentService } from "../../lib/ssi/did_document_service";
import { credentialService } from "../../lib/ssi/credential_service";
import { celestiaAnchorService } from "../../lib/ssi/celestia_anchor_service";

import type {
  DIDString,
  SSIIdentityCreateParams,
  SSIIdentityUpdateParams,
  SSICredentialIssueParams,
  SSICredentialListParams,
  SSIPresentationCreateParams,
  SSIAnchorHistoryParams,
  VerifiableCredential,
  VerifiablePresentation,
  IdentityType,
  DIDEvent,
} from "../../types/ssi_types";

// In-memory private key cache (per session, never persisted in plaintext)
// In production, integrate with JCN Key Manager or OS keyring
const privateKeyCache = new Map<string, string>();

export function registerSsiHandlers(): void {
  // ─── Identity Handlers ──────────────────────────────────────────────

  ipcMain.handle(
    "ssi:identity:create",
    async (_, params: SSIIdentityCreateParams) => {
      const result = await didDocumentService.createIdentity(params);

      // Cache the private key in memory for this session
      privateKeyCache.set(result.identity.did, result.privateKeyHex);

      // Anchor identity creation to Celestia
      const event: DIDEvent = {
        id: crypto.randomUUID(),
        type: "created",
        did: result.identity.did,
        timestamp: new Date().toISOString(),
        description: `Primary identity created: ${params.displayName}`,
      };

      try {
        const anchor = await celestiaAnchorService.anchorDIDEvent(event);
        return { identity: result.identity, anchor };
      } catch {
        return { identity: result.identity, anchor: null };
      }
    },
  );

  ipcMain.handle("ssi:identity:get", async (_, did?: DIDString) => {
    if (did) {
      return didDocumentService.getIdentity(did);
    }
    return didDocumentService.getPrimaryIdentity();
  });

  ipcMain.handle("ssi:identity:list", async (_, type?: IdentityType) => {
    return didDocumentService.listIdentities(type);
  });

  ipcMain.handle(
    "ssi:identity:update",
    async (_, params: SSIIdentityUpdateParams) => {
      const result = await didDocumentService.updateIdentity(params);

      // Anchor update event
      const event: DIDEvent = {
        id: crypto.randomUUID(),
        type: "updated",
        did: params.did,
        timestamp: new Date().toISOString(),
        description: "Identity profile updated",
      };
      celestiaAnchorService.anchorDIDEvent(event).catch(() => {});

      return result;
    },
  );

  ipcMain.handle("ssi:identity:deactivate", async (_, did: DIDString) => {
    await didDocumentService.deactivateIdentity(did);

    // Anchor deactivation event
    const event: DIDEvent = {
      id: crypto.randomUUID(),
      type: "deactivated",
      did,
      timestamp: new Date().toISOString(),
      description: "Identity deactivated",
    };
    celestiaAnchorService.anchorDIDEvent(event).catch(() => {});
  });

  ipcMain.handle("ssi:identity:resolve", async (_, did: DIDString) => {
    const doc = await didDocumentService.resolveDID(did);
    if (!doc) throw new Error(`DID not found: ${did}`);
    return doc;
  });

  ipcMain.handle(
    "ssi:identity:link",
    async (
      _,
      params: {
        primaryDid: DIDString;
        linkedDid: DIDString;
        linkedType: IdentityType;
        linkedPublicKey: string;
        algorithm: "ed25519" | "secp256k1";
      },
    ) => {
      return didDocumentService.linkIdentity(
        params.primaryDid,
        params.linkedDid,
        params.linkedType,
        params.linkedPublicKey,
        params.algorithm,
      );
    },
  );

  // ─── Credential Handlers ────────────────────────────────────────────

  ipcMain.handle(
    "ssi:credential:issue",
    async (
      _,
      params: SSICredentialIssueParams & { issuerDid: DIDString },
    ) => {
      const privateKey = privateKeyCache.get(params.issuerDid);
      if (!privateKey) {
        throw new Error(
          "Issuer private key not available. Create or unlock identity first.",
        );
      }

      const credential = await credentialService.issueCredential(
        params.issuerDid,
        params,
        privateKey,
      );

      // Anchor credential issuance
      const credentialHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(credential))
        .digest("hex");

      celestiaAnchorService
        .anchorCredential(credential.id, params.issuerDid, credentialHash)
        .catch(() => {});

      return credential;
    },
  );

  ipcMain.handle(
    "ssi:credential:verify",
    async (_, credential: VerifiableCredential) => {
      return credentialService.verifyCredential(credential);
    },
  );

  ipcMain.handle(
    "ssi:credential:list",
    async (_, params?: SSICredentialListParams) => {
      return credentialService.listCredentials(params);
    },
  );

  ipcMain.handle("ssi:credential:get", async (_, credentialId: string) => {
    const vc = await credentialService.getCredential(credentialId);
    if (!vc) throw new Error(`Credential not found: ${credentialId}`);
    return vc;
  });

  ipcMain.handle(
    "ssi:credential:revoke",
    async (
      _,
      params: { credentialId: string; issuerDid: DIDString },
    ) => {
      await credentialService.revokeCredential(
        params.credentialId,
        params.issuerDid,
      );

      // Anchor revocation
      const event: DIDEvent = {
        id: crypto.randomUUID(),
        type: "credential-revoked",
        did: params.issuerDid,
        timestamp: new Date().toISOString(),
        description: `Credential ${params.credentialId} revoked`,
      };
      celestiaAnchorService.anchorDIDEvent(event).catch(() => {});
    },
  );

  ipcMain.handle(
    "ssi:credential:import",
    async (_, credential: VerifiableCredential) => {
      await credentialService.importCredential(credential);
    },
  );

  ipcMain.handle(
    "ssi:credential:export",
    async (_, credentialId: string) => {
      return credentialService.exportCredential(credentialId);
    },
  );

  // ─── Presentation Handlers ─────────────────────────────────────────

  ipcMain.handle(
    "ssi:presentation:create",
    async (
      _,
      params: SSIPresentationCreateParams & { holderDid: DIDString },
    ) => {
      const privateKey = privateKeyCache.get(params.holderDid);
      if (!privateKey) {
        throw new Error(
          "Holder private key not available. Create or unlock identity first.",
        );
      }
      return credentialService.createPresentation(
        params.holderDid,
        params,
        privateKey,
      );
    },
  );

  ipcMain.handle(
    "ssi:presentation:verify",
    async (_, presentation: VerifiablePresentation) => {
      return credentialService.verifyPresentation(presentation);
    },
  );

  ipcMain.handle(
    "ssi:presentation:list",
    async (_, holderDid?: DIDString) => {
      return credentialService.listPresentations(holderDid);
    },
  );

  // ─── Anchor Handlers ───────────────────────────────────────────────

  ipcMain.handle("ssi:anchor:submit", async (_, event: DIDEvent) => {
    return celestiaAnchorService.anchorDIDEvent(event);
  });

  ipcMain.handle(
    "ssi:anchor:verify",
    async (_, anchor: { contentHash: string; height: number; namespace: string; anchoredAt: string }) => {
      return celestiaAnchorService.verifyAnchor(anchor);
    },
  );

  ipcMain.handle(
    "ssi:anchor:history",
    async (_, params: SSIAnchorHistoryParams) => {
      return celestiaAnchorService.getAnchorHistory(
        params.did,
        params.limit,
        params.offset,
      );
    },
  );
}
