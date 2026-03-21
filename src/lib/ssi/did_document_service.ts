/**
 * DID Document Service
 *
 * Creates, resolves, updates, and deactivates W3C-compliant DID Documents.
 * Supports did:joy (local) and did:key (multibase) resolution.
 * Maps existing JoyCreate identity systems (Chat, Federation, JCN) into
 * proper DID Documents.
 */

import * as crypto from "crypto";
import log from "electron-log";
import { db } from "@/db";
import { ssiIdentities, ssiAnchorLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";

import type {
  DIDString,
  DIDDocument,
  VerificationMethod,
  ServiceEndpoint,
  SSIIdentity,
  SSIIdentityCreateParams,
  SSIIdentityUpdateParams,
  IdentityType,
  DIDEvent,
} from "@/types/ssi_types";

const logger = log.scope("ssi_did");

const DID_CONTEXT = "https://www.w3.org/ns/did/v1";
const DID_SECURITY_CONTEXT = "https://w3id.org/security/suites/ed25519-2020/v1";

// =============================================================================
// DID GENERATION
// =============================================================================

/**
 * Generate a did:joy DID from a public key.
 * Format: did:joy:{first-32-chars-of-sha256(publicKey)}
 */
export function didFromPublicKey(publicKey: string | Buffer): DIDString {
  const hash = crypto
    .createHash("sha256")
    .update(typeof publicKey === "string" ? publicKey : publicKey)
    .digest("hex")
    .slice(0, 32);
  return `did:joy:${hash}` as DIDString;
}

/**
 * Generate a did:key DID from an Ed25519 public key.
 * Uses multicodec prefix 0xed01 for Ed25519.
 */
export function didKeyFromEd25519(publicKeyBytes: Buffer): DIDString {
  const multicodecPrefix = Buffer.from([0xed, 0x01]);
  const multicodec = Buffer.concat([multicodecPrefix, publicKeyBytes]);
  const multibase = `z${base58btc(multicodec)}`;
  return `did:key:${multibase}` as DIDString;
}

// Simple base58btc encoder (Bitcoin alphabet)
function base58btc(data: Buffer): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = BigInt(`0x${data.toString("hex")}`);
  const result: string[] = [];
  while (num > 0n) {
    const [quotient, remainder] = [num / 58n, num % 58n];
    result.unshift(ALPHABET[Number(remainder)]);
    num = quotient;
  }
  // leading zeros
  for (const byte of data) {
    if (byte === 0) result.unshift("1");
    else break;
  }
  return result.join("");
}

// =============================================================================
// DID DOCUMENT CREATION
// =============================================================================

/**
 * Build a W3C-compliant DID Document from a DID and public keys.
 */
export function buildDIDDocument(
  did: DIDString,
  keys: {
    signing?: { algorithm: "ed25519" | "secp256k1"; publicKeyHex: string };
    encryption?: { publicKeyHex: string };
  },
  services?: ServiceEndpoint[],
): DIDDocument {
  const verificationMethods: VerificationMethod[] = [];
  const authentication: string[] = [];
  const assertionMethod: string[] = [];
  const keyAgreement: string[] = [];

  if (keys.signing) {
    const vmId = `${did}#signing-key-1`;
    const vmType =
      keys.signing.algorithm === "ed25519"
        ? "Ed25519VerificationKey2020"
        : "EcdsaSecp256k1VerificationKey2019";
    verificationMethods.push({
      id: vmId,
      type: vmType,
      controller: did,
      publicKeyMultibase: `z${keys.signing.publicKeyHex}`,
    });
    authentication.push(vmId);
    assertionMethod.push(vmId);
  }

  if (keys.encryption) {
    const vmId = `${did}#encryption-key-1`;
    verificationMethods.push({
      id: vmId,
      type: "X25519KeyAgreementKey2020",
      controller: did,
      publicKeyMultibase: `z${keys.encryption.publicKeyHex}`,
    });
    keyAgreement.push(vmId);
  }

  const now = new Date().toISOString();
  return {
    "@context": [DID_CONTEXT, DID_SECURITY_CONTEXT],
    id: did,
    verificationMethod: verificationMethods,
    authentication,
    assertionMethod,
    keyAgreement: keyAgreement.length > 0 ? keyAgreement : undefined,
    service: services,
    created: now,
    updated: now,
  };
}

// =============================================================================
// DID DOCUMENT SERVICE
// =============================================================================

class DIDDocumentService {
  /**
   * Create a new primary identity with DID Document.
   * Generates Ed25519 or secp256k1 keypair, stores in DB.
   */
  async createIdentity(
    params: SSIIdentityCreateParams,
  ): Promise<{ identity: SSIIdentity; privateKeyHex: string }> {
    const algorithm = params.keyAlgorithm ?? "ed25519";
    const { publicKey, privateKey } = crypto.generateKeyPairSync(
      algorithm === "ed25519" ? "ed25519" : "ec",
      algorithm === "ed25519"
        ? undefined
        : { namedCurve: "secp256k1" },
    );

    const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
    const privateKeyDer = privateKey.export({ type: "pkcs8", format: "der" });
    const publicKeyHex = publicKeyDer.toString("hex");
    const privateKeyHex = privateKeyDer.toString("hex");

    const did = didFromPublicKey(publicKeyHex);
    const didDocument = buildDIDDocument(did, {
      signing: { algorithm, publicKeyHex },
    });

    const now = new Date();
    const identity: SSIIdentity = {
      did,
      identityType: "primary",
      displayName: params.displayName,
      bio: params.bio,
      avatar: params.avatar,
      didDocument,
      active: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await db.insert(ssiIdentities).values({
      did,
      identityType: "primary",
      displayName: params.displayName,
      bio: params.bio,
      avatar: params.avatar,
      didDocumentJson: didDocument as unknown as Record<string, unknown>,
      publicKey: publicKeyHex,
      algorithm,
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    logger.info(`Created primary identity: ${did}`);
    return { identity, privateKeyHex };
  }

  /**
   * Resolve a DID to its DID Document.
   * Supports did:joy (from local DB) and did:key (computed).
   */
  async resolveDID(did: DIDString): Promise<DIDDocument | null> {
    if (did.startsWith("did:key:")) {
      return this.resolveDidKey(did);
    }

    const rows = await db
      .select()
      .from(ssiIdentities)
      .where(eq(ssiIdentities.did, did))
      .limit(1);

    if (rows.length === 0) return null;
    return rows[0].didDocumentJson as unknown as DIDDocument;
  }

  /**
   * Resolve a did:key to a DID Document (computed, not stored).
   */
  private resolveDidKey(did: DIDString): DIDDocument {
    const multibase = did.replace("did:key:", "");
    return {
      "@context": [DID_CONTEXT, DID_SECURITY_CONTEXT],
      id: did,
      verificationMethod: [
        {
          id: `${did}#${multibase}`,
          type: "Ed25519VerificationKey2020",
          controller: did,
          publicKeyMultibase: multibase,
        },
      ],
      authentication: [`${did}#${multibase}`],
      assertionMethod: [`${did}#${multibase}`],
    };
  }

  /**
   * Get a locally stored identity by DID.
   */
  async getIdentity(did: DIDString): Promise<SSIIdentity | null> {
    const rows = await db
      .select()
      .from(ssiIdentities)
      .where(eq(ssiIdentities.did, did))
      .limit(1);

    if (rows.length === 0) return null;
    return this.rowToIdentity(rows[0]);
  }

  /**
   * Get the primary identity (if one exists).
   */
  async getPrimaryIdentity(): Promise<SSIIdentity | null> {
    const rows = await db
      .select()
      .from(ssiIdentities)
      .where(
        and(
          eq(ssiIdentities.identityType, "primary"),
          eq(ssiIdentities.active, true),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return this.rowToIdentity(rows[0]);
  }

  /**
   * List all identities, optionally filtered by type.
   */
  async listIdentities(type?: IdentityType): Promise<SSIIdentity[]> {
    const query = type
      ? db
          .select()
          .from(ssiIdentities)
          .where(eq(ssiIdentities.identityType, type))
      : db.select().from(ssiIdentities);

    const rows = await query;
    return rows.map((r) => this.rowToIdentity(r));
  }

  /**
   * Update an identity's profile and DID Document.
   */
  async updateIdentity(params: SSIIdentityUpdateParams): Promise<SSIIdentity> {
    const existing = await this.getIdentity(params.did);
    if (!existing) throw new Error(`Identity not found: ${params.did}`);

    const updatedDoc = { ...existing.didDocument };
    updatedDoc.updated = new Date().toISOString();

    if (params.services) {
      updatedDoc.service = params.services;
    }

    const now = new Date();
    await db
      .update(ssiIdentities)
      .set({
        displayName: params.displayName ?? existing.displayName,
        bio: params.bio ?? existing.bio,
        avatar: params.avatar ?? existing.avatar,
        didDocumentJson: updatedDoc as unknown as Record<string, unknown>,
        updatedAt: now,
      })
      .where(eq(ssiIdentities.did, params.did));

    logger.info(`Updated identity: ${params.did}`);
    return (await this.getIdentity(params.did))!;
  }

  /**
   * Deactivate an identity (marks DID Document as deactivated).
   */
  async deactivateIdentity(did: DIDString): Promise<void> {
    const existing = await this.getIdentity(did);
    if (!existing) throw new Error(`Identity not found: ${did}`);

    const updatedDoc = { ...existing.didDocument, deactivated: true };
    updatedDoc.updated = new Date().toISOString();

    await db
      .update(ssiIdentities)
      .set({
        active: false,
        didDocumentJson: updatedDoc as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(ssiIdentities.did, did));

    logger.info(`Deactivated identity: ${did}`);
  }

  /**
   * Link an existing Chat/Federation/JCN identity to a primary DID.
   * Creates a new SSI identity record referencing the linked system.
   */
  async linkIdentity(
    primaryDid: DIDString,
    linkedDid: DIDString,
    linkedType: IdentityType,
    linkedPublicKey: string,
    algorithm: "ed25519" | "secp256k1",
  ): Promise<SSIIdentity> {
    const primary = await this.getIdentity(primaryDid);
    if (!primary) throw new Error(`Primary identity not found: ${primaryDid}`);

    const didDocument = buildDIDDocument(linkedDid, {
      signing: { algorithm, publicKeyHex: linkedPublicKey },
    });

    const now = new Date();
    await db.insert(ssiIdentities).values({
      did: linkedDid,
      identityType: linkedType,
      displayName: primary.displayName,
      didDocumentJson: didDocument as unknown as Record<string, unknown>,
      publicKey: linkedPublicKey,
      algorithm,
      linkedToDid: primaryDid,
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    logger.info(`Linked ${linkedType} identity ${linkedDid} to ${primaryDid}`);
    return (await this.getIdentity(linkedDid))!;
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private rowToIdentity(row: typeof ssiIdentities.$inferSelect): SSIIdentity {
    const linkedDids: DIDString[] = [];
    if (row.linkedToDid) {
      linkedDids.push(row.linkedToDid as DIDString);
    }
    return {
      did: row.did as DIDString,
      identityType: row.identityType as IdentityType,
      displayName: row.displayName ?? undefined,
      bio: row.bio ?? undefined,
      avatar: row.avatar ?? undefined,
      didDocument: row.didDocumentJson as unknown as DIDDocument,
      active: row.active,
      linkedDids: linkedDids.length > 0 ? linkedDids : undefined,
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt as unknown as number * 1000).toISOString(),
      updatedAt: row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : new Date(row.updatedAt as unknown as number * 1000).toISOString(),
    };
  }
}

export const didDocumentService = new DIDDocumentService();
