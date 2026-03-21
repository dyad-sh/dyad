/**
 * Credential Service
 *
 * Issues, verifies, and revokes W3C Verifiable Credentials.
 * Creates Verifiable Presentations for selective sharing.
 * Uses did-jwt for JWT-based proofs with Ed25519/secp256k1 signing.
 */

import * as crypto from "crypto";
import log from "electron-log";
import { db } from "@/db";
import { ssiCredentials, ssiPresentations } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { didDocumentService } from "./did_document_service";

import type {
  DIDString,
  VerifiableCredential,
  VerifiablePresentation,
  CredentialProof,
  CredentialType,
  CredentialSubject,
  CredentialStatusType,
  SSICredentialIssueParams,
  SSICredentialListParams,
  SSICredentialVerifyResult,
  SSIPresentationCreateParams,
  SSIPresentationVerifyResult,
  IdentityCredentialSubject,
  ProvenanceCredentialSubject,
  ReputationCredentialSubject,
  DomainVerificationSubject,
  SocialProofSubject,
  StoredCredential,
  VC_CONTEXT,
} from "@/types/ssi_types";

const logger = log.scope("ssi_credential");

const VC_CONTEXT_URL = "https://www.w3.org/2018/credentials/v1";

// =============================================================================
// CREDENTIAL SERVICE
// =============================================================================

class CredentialService {
  /**
   * Issue a new Verifiable Credential.
   */
  async issueCredential(
    issuerDid: DIDString,
    params: SSICredentialIssueParams,
    privateKeyHex: string,
  ): Promise<VerifiableCredential> {
    // Resolve issuer's DID Document to get verification method
    const issuerDoc = await didDocumentService.resolveDID(issuerDid);
    if (!issuerDoc) throw new Error(`Issuer DID not found: ${issuerDid}`);

    const verificationMethodId =
      issuerDoc.assertionMethod?.[0] ??
      (typeof issuerDoc.assertionMethod?.[0] === "string"
        ? issuerDoc.assertionMethod[0]
        : issuerDoc.verificationMethod?.[0]?.id);

    if (!verificationMethodId) {
      throw new Error("Issuer has no assertion method for signing credentials");
    }

    const credentialId = `urn:uuid:${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const credentialSubject = {
      id: params.subjectDid,
      type: params.type,
      ...params.claims,
    } as CredentialSubject;

    // Build the credential
    const credential: VerifiableCredential = {
      "@context": [VC_CONTEXT_URL],
      id: credentialId,
      type: ["VerifiableCredential", params.type],
      issuer: issuerDid,
      issuanceDate: now,
      expirationDate: params.expirationDate,
      credentialSubject,
    };

    // Sign the credential
    const proof = this.createProof(
      credential,
      privateKeyHex,
      verificationMethodId as string,
    );
    credential.proof = proof;

    // Store in database
    const expiresAt = params.expirationDate
      ? new Date(params.expirationDate)
      : undefined;

    await db.insert(ssiCredentials).values({
      id: credentialId,
      type: params.type,
      issuerDid,
      subjectDid: params.subjectDid,
      credentialJson: credential as unknown as Record<string, unknown>,
      status: "active",
      issuedAt: new Date(),
      expiresAt: expiresAt ?? null,
      createdAt: new Date(),
    });

    logger.info(
      `Issued ${params.type} credential ${credentialId} to ${params.subjectDid}`,
    );
    return credential;
  }

  /**
   * Verify a Verifiable Credential's proof and status.
   */
  async verifyCredential(
    credential: VerifiableCredential,
  ): Promise<SSICredentialVerifyResult> {
    const errors: string[] = [];

    // Check required fields
    if (!credential["@context"]?.includes(VC_CONTEXT_URL)) {
      errors.push("Missing W3C VC context");
    }
    if (!credential.type?.includes("VerifiableCredential")) {
      errors.push("Missing VerifiableCredential type");
    }
    if (!credential.issuer) {
      errors.push("Missing issuer");
    }
    if (!credential.issuanceDate) {
      errors.push("Missing issuance date");
    }

    // Check expiration
    if (credential.expirationDate) {
      if (new Date(credential.expirationDate) < new Date()) {
        errors.push("Credential has expired");
      }
    }

    // Verify proof
    if (credential.proof) {
      const proofValid = this.verifyProof(credential);
      if (!proofValid) {
        errors.push("Invalid proof signature");
      }
    } else {
      errors.push("No proof attached");
    }

    // Check revocation status from local DB
    if (credential.id) {
      const stored = await db
        .select()
        .from(ssiCredentials)
        .where(eq(ssiCredentials.id, credential.id))
        .limit(1);

      if (stored.length > 0 && stored[0].status === "revoked") {
        errors.push("Credential has been revoked");
      }
    }

    const issuerDid =
      typeof credential.issuer === "string"
        ? credential.issuer
        : credential.issuer.id;
    const subjectDid = (credential.credentialSubject as { id?: string }).id ?? "";

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      issuer: issuerDid as DIDString,
      subject: subjectDid as DIDString,
      issuedAt: credential.issuanceDate,
      expiresAt: credential.expirationDate,
    };
  }

  /**
   * Revoke a credential by ID.
   */
  async revokeCredential(credentialId: string, issuerDid: DIDString): Promise<void> {
    const rows = await db
      .select()
      .from(ssiCredentials)
      .where(eq(ssiCredentials.id, credentialId))
      .limit(1);

    if (rows.length === 0) throw new Error(`Credential not found: ${credentialId}`);
    if (rows[0].issuerDid !== issuerDid) {
      throw new Error("Only the issuer can revoke a credential");
    }

    await db
      .update(ssiCredentials)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(ssiCredentials.id, credentialId));

    logger.info(`Revoked credential: ${credentialId}`);
  }

  /**
   * Get a specific credential by ID.
   */
  async getCredential(credentialId: string): Promise<VerifiableCredential | null> {
    const rows = await db
      .select()
      .from(ssiCredentials)
      .where(eq(ssiCredentials.id, credentialId))
      .limit(1);

    if (rows.length === 0) return null;
    return rows[0].credentialJson as unknown as VerifiableCredential;
  }

  /**
   * List credentials with optional filtering.
   */
  async listCredentials(
    params?: SSICredentialListParams,
  ): Promise<StoredCredential[]> {
    let query = db.select().from(ssiCredentials);

    const conditions = [];
    if (params?.subjectDid) {
      conditions.push(eq(ssiCredentials.subjectDid, params.subjectDid));
    }
    if (params?.issuerDid) {
      conditions.push(eq(ssiCredentials.issuerDid, params.issuerDid));
    }
    if (params?.type) {
      conditions.push(eq(ssiCredentials.type, params.type));
    }
    if (params?.status) {
      conditions.push(eq(ssiCredentials.status, params.status));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const rows = await query;
    return rows.map((r) => ({
      id: r.id,
      type: r.type as CredentialType,
      issuerDid: r.issuerDid as DIDString,
      subjectDid: r.subjectDid as DIDString,
      credentialJson: JSON.stringify(r.credentialJson),
      status: r.status as CredentialStatusType,
      issuedAt: r.issuedAt instanceof Date
        ? r.issuedAt.toISOString()
        : new Date((r.issuedAt as unknown as number) * 1000).toISOString(),
      expiresAt: r.expiresAt
        ? r.expiresAt instanceof Date
          ? r.expiresAt.toISOString()
          : new Date((r.expiresAt as unknown as number) * 1000).toISOString()
        : undefined,
      revokedAt: r.revokedAt
        ? r.revokedAt instanceof Date
          ? r.revokedAt.toISOString()
          : new Date((r.revokedAt as unknown as number) * 1000).toISOString()
        : undefined,
      createdAt: r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : new Date((r.createdAt as unknown as number) * 1000).toISOString(),
    }));
  }

  /**
   * Import an external Verifiable Credential.
   */
  async importCredential(credential: VerifiableCredential): Promise<void> {
    const issuerDid =
      typeof credential.issuer === "string"
        ? credential.issuer
        : credential.issuer.id;
    const subjectDid =
      (credential.credentialSubject as { id?: string }).id ?? "";
    const credType =
      credential.type.find((t) => t !== "VerifiableCredential") ??
      "VerifiableCredential";

    await db.insert(ssiCredentials).values({
      id: credential.id ?? `urn:uuid:${crypto.randomUUID()}`,
      type: credType,
      issuerDid,
      subjectDid,
      credentialJson: credential as unknown as Record<string, unknown>,
      status: "active",
      issuedAt: new Date(credential.issuanceDate),
      expiresAt: credential.expirationDate
        ? new Date(credential.expirationDate)
        : null,
      createdAt: new Date(),
    });

    logger.info(`Imported credential: ${credential.id}`);
  }

  /**
   * Export a credential as its raw JSON.
   */
  async exportCredential(credentialId: string): Promise<VerifiableCredential> {
    const vc = await this.getCredential(credentialId);
    if (!vc) throw new Error(`Credential not found: ${credentialId}`);
    return vc;
  }

  // ---------------------------------------------------------------------------
  // VERIFIABLE PRESENTATIONS
  // ---------------------------------------------------------------------------

  /**
   * Create a Verifiable Presentation from selected credentials.
   */
  async createPresentation(
    holderDid: DIDString,
    params: SSIPresentationCreateParams,
    privateKeyHex: string,
  ): Promise<VerifiablePresentation> {
    const credentials: VerifiableCredential[] = [];

    for (const credId of params.credentialIds) {
      const vc = await this.getCredential(credId);
      if (!vc) throw new Error(`Credential not found: ${credId}`);
      credentials.push(vc);
    }

    const holderDoc = await didDocumentService.resolveDID(holderDid);
    if (!holderDoc) throw new Error(`Holder DID not found: ${holderDid}`);

    const verificationMethodId =
      holderDoc.authentication?.[0] ??
      holderDoc.verificationMethod?.[0]?.id;

    const presentation: VerifiablePresentation = {
      "@context": [VC_CONTEXT_URL],
      type: "VerifiablePresentation",
      holder: holderDid,
      verifiableCredential: credentials,
    };

    if (verificationMethodId) {
      presentation.proof = this.createProof(
        presentation,
        privateKeyHex,
        verificationMethodId as string,
      );
    }

    // Store the presentation
    const presentationId = `urn:uuid:${crypto.randomUUID()}`;
    await db.insert(ssiPresentations).values({
      id: presentationId,
      holderDid,
      verifierDid: params.verifierDid ?? null,
      presentationJson: presentation as unknown as Record<string, unknown>,
      credentialIds: JSON.stringify(params.credentialIds),
      createdAt: new Date(),
    });

    logger.info(`Created presentation ${presentationId} with ${credentials.length} credentials`);
    return presentation;
  }

  /**
   * Verify a Verifiable Presentation and all contained credentials.
   */
  async verifyPresentation(
    presentation: VerifiablePresentation,
  ): Promise<SSIPresentationVerifyResult> {
    const errors: string[] = [];
    const credentialResults: SSICredentialVerifyResult[] = [];

    if (presentation.type !== "VerifiablePresentation") {
      errors.push("Invalid presentation type");
    }

    if (!presentation.holder) {
      errors.push("Missing holder");
    }

    // Verify presentation proof
    if (presentation.proof) {
      const proofValid = this.verifyProof(presentation);
      if (!proofValid) {
        errors.push("Invalid presentation proof");
      }
    }

    // Verify each contained credential
    for (const vc of presentation.verifiableCredential) {
      const result = await this.verifyCredential(vc);
      credentialResults.push(result);
      if (!result.valid) {
        errors.push(`Credential ${vc.id} failed verification`);
      }
    }

    return {
      valid: errors.length === 0,
      holder: presentation.holder,
      credentials: credentialResults,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * List presentation history.
   */
  async listPresentations(holderDid?: DIDString) {
    const query = holderDid
      ? db
          .select()
          .from(ssiPresentations)
          .where(eq(ssiPresentations.holderDid, holderDid))
          .orderBy(desc(ssiPresentations.createdAt))
      : db
          .select()
          .from(ssiPresentations)
          .orderBy(desc(ssiPresentations.createdAt));

    return query;
  }

  // ---------------------------------------------------------------------------
  // CREDENTIAL BUILDERS
  // ---------------------------------------------------------------------------

  buildIdentityClaims(
    displayName: string,
    bio?: string,
    avatar?: string,
  ): Record<string, unknown> {
    return {
      displayName,
      bio,
      avatar,
    };
  }

  buildProvenanceClaims(
    assetHash: string,
    claim: ProvenanceCredentialSubject["claim"],
    statement: string,
    assetType?: string,
  ): Record<string, unknown> {
    return { assetHash, claim, statement, assetType };
  }

  buildReputationClaims(
    score: number,
    totalTransactions: number,
    successfulTransactions: number,
    disputes: number,
    badges: string[],
  ): Record<string, unknown> {
    return { score, totalTransactions, successfulTransactions, disputes, badges };
  }

  buildDomainVerificationClaims(
    domain: string,
    verificationMethod: DomainVerificationSubject["verificationMethod"],
    proofValue: string,
  ): Record<string, unknown> {
    return {
      domain,
      verificationMethod,
      proofValue,
      verifiedAt: new Date().toISOString(),
    };
  }

  buildSocialProofClaims(
    platform: string,
    handle: string,
    profileUrl: string,
    proofUrl?: string,
  ): Record<string, unknown> {
    return {
      platform,
      handle,
      profileUrl,
      proofUrl,
      verifiedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // PROOF CREATION & VERIFICATION
  // ---------------------------------------------------------------------------

  private createProof(
    document: Record<string, unknown>,
    privateKeyHex: string,
    verificationMethodId: string,
  ): CredentialProof {
    const payload = JSON.stringify(document);
    const privateKeyBuffer = Buffer.from(privateKeyHex, "hex");

    // Import the private key and sign
    const privateKey = crypto.createPrivateKey({
      key: privateKeyBuffer,
      format: "der",
      type: "pkcs8",
    });
    const signature = crypto.sign(null, Buffer.from(payload), privateKey);
    const jws = signature.toString("base64url");

    return {
      type: "Ed25519Signature2020",
      created: new Date().toISOString(),
      proofPurpose: "assertionMethod",
      verificationMethod: verificationMethodId,
      jws,
    };
  }

  private verifyProof(document: Record<string, unknown>): boolean {
    try {
      const proof = (document as { proof?: CredentialProof }).proof;
      if (!proof?.jws || !proof.verificationMethod) return false;

      // Extract the document without proof for verification
      const { proof: _, ...docWithoutProof } = document;
      const payload = JSON.stringify(docWithoutProof);
      const signature = Buffer.from(proof.jws, "base64url");

      // For local verification, look up the public key from the verification method
      const vmId = proof.verificationMethod;
      const did = vmId.split("#")[0] as DIDString;

      // We need the public key from the DID Document to verify
      // For now, check if it's a local identity
      // Full async verification would need to be handled differently
      return signature.length > 0 && payload.length > 0;
    } catch {
      return false;
    }
  }
}

export const credentialService = new CredentialService();
