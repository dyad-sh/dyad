// ─── W3C DID Core Types ──────────────────────────────────────────────

export type DIDString = `did:${string}`;

export interface DIDDocument {
  "@context": string[];
  id: DIDString;
  controller?: DIDString | DIDString[];
  alsoKnownAs?: string[];
  verificationMethod?: VerificationMethod[];
  authentication?: (string | VerificationMethod)[];
  assertionMethod?: (string | VerificationMethod)[];
  keyAgreement?: (string | VerificationMethod)[];
  capabilityInvocation?: (string | VerificationMethod)[];
  capabilityDelegation?: (string | VerificationMethod)[];
  service?: ServiceEndpoint[];
  deactivated?: boolean;
  created?: string;
  updated?: string;
}

export type VerificationMethodType =
  | "Ed25519VerificationKey2020"
  | "EcdsaSecp256k1VerificationKey2019"
  | "X25519KeyAgreementKey2020"
  | "JsonWebKey2020";

export interface VerificationMethod {
  id: string;
  type: VerificationMethodType;
  controller: DIDString;
  publicKeyMultibase?: string;
  publicKeyJwk?: JsonWebKey;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string | string[] | Record<string, string>;
}

// ─── W3C Verifiable Credentials ─────────────────────────────────────

export const VC_CONTEXT = "https://www.w3.org/2018/credentials/v1" as const;
export const VC_CONTEXT_V2 = "https://www.w3.org/ns/credentials/v2" as const;

export type CredentialType =
  | "VerifiableCredential"
  | "IdentityCredential"
  | "ProvenanceCredential"
  | "ReputationCredential"
  | "DomainVerificationCredential"
  | "SocialProofCredential";

export type CredentialStatusType = "active" | "revoked" | "expired" | "suspended";

export interface CredentialProof {
  type: string;
  created: string;
  proofPurpose: "assertionMethod" | "authentication";
  verificationMethod: string;
  jws?: string;
  proofValue?: string;
}

export interface CredentialStatus {
  id: string;
  type: "RevocationList2020Status" | "StatusList2021Entry";
  statusListIndex?: string;
  statusListCredential?: string;
}

export interface VerifiableCredential {
  "@context": string[];
  id: string;
  type: CredentialType[];
  issuer: DIDString | { id: DIDString; name?: string };
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: CredentialSubject;
  credentialStatus?: CredentialStatus;
  proof?: CredentialProof;
}

export interface VerifiablePresentation {
  "@context": string[];
  type: "VerifiablePresentation";
  holder: DIDString;
  verifiableCredential: VerifiableCredential[];
  proof?: CredentialProof;
}

// ─── Credential Subject Schemas ─────────────────────────────────────

export type CredentialSubject =
  | IdentityCredentialSubject
  | ProvenanceCredentialSubject
  | ReputationCredentialSubject
  | DomainVerificationSubject
  | SocialProofSubject;

export interface IdentityCredentialSubject {
  id: DIDString;
  type: "IdentityCredential";
  displayName: string;
  bio?: string;
  avatar?: string;
  publicKeys?: {
    signing?: string;
    encryption?: string;
    recovery?: string;
  };
}

export interface ProvenanceCredentialSubject {
  id: DIDString;
  type: "ProvenanceCredential";
  assetHash: string;
  claim: "ownership" | "authenticity" | "quality" | "provenance" | "compliance";
  statement: string;
  assetType?: string;
  sourceUrl?: string;
}

export interface ReputationCredentialSubject {
  id: DIDString;
  type: "ReputationCredential";
  score: number;
  totalTransactions: number;
  successfulTransactions: number;
  disputes: number;
  badges: string[];
  reviewCount?: number;
  averageRating?: number;
}

export interface DomainVerificationSubject {
  id: DIDString;
  type: "DomainVerificationCredential";
  domain: string;
  verificationMethod: "dns-txt" | "well-known" | "meta-tag";
  proofValue: string;
  verifiedAt: string;
}

export interface SocialProofSubject {
  id: DIDString;
  type: "SocialProofCredential";
  platform: string;
  handle: string;
  profileUrl: string;
  proofUrl?: string;
  verifiedAt: string;
}

// ─── Celestia Anchoring ─────────────────────────────────────────────

export interface CelestiaAnchor {
  txHash?: string;
  height: number;
  namespace: string;
  contentHash: string;
  commitment?: string;
  anchoredAt: string;
}

export type DIDEventType =
  | "created"
  | "updated"
  | "deactivated"
  | "key-rotated"
  | "service-added"
  | "service-removed"
  | "credential-issued"
  | "credential-revoked"
  | "anchored";

export interface DIDEvent {
  id: string;
  type: DIDEventType;
  did: DIDString;
  timestamp: string;
  description?: string;
  dataHash?: string;
  celestiaAnchor?: CelestiaAnchor;
  metadata?: Record<string, unknown>;
}

// ─── SSI Identity (Aggregated View) ─────────────────────────────────

export type IdentityType = "primary" | "chat" | "federation" | "jcn";

export interface SSIIdentity {
  did: DIDString;
  identityType: IdentityType;
  displayName?: string;
  bio?: string;
  avatar?: string;
  didDocument: DIDDocument;
  active: boolean;
  linkedDids?: DIDString[];
  createdAt: string;
  updatedAt: string;
}

export interface SSIIdentityCreateParams {
  displayName: string;
  bio?: string;
  avatar?: string;
  keyAlgorithm?: "ed25519" | "secp256k1";
}

export interface SSIIdentityUpdateParams {
  did: DIDString;
  displayName?: string;
  bio?: string;
  avatar?: string;
  services?: ServiceEndpoint[];
}

export interface SSICredentialIssueParams {
  subjectDid: DIDString;
  type: CredentialType;
  claims: Record<string, unknown>;
  expirationDate?: string;
}

export interface SSICredentialListParams {
  subjectDid?: DIDString;
  issuerDid?: DIDString;
  type?: CredentialType;
  status?: CredentialStatusType;
}

export interface SSIPresentationCreateParams {
  credentialIds: string[];
  verifierDid?: DIDString;
}

export interface SSICredentialVerifyResult {
  valid: boolean;
  errors?: string[];
  issuer: DIDString;
  subject: DIDString;
  issuedAt: string;
  expiresAt?: string;
}

export interface SSIPresentationVerifyResult {
  valid: boolean;
  holder: DIDString;
  credentials: SSICredentialVerifyResult[];
  errors?: string[];
}

export interface SSIAnchorHistoryParams {
  did: DIDString;
  limit?: number;
  offset?: number;
}

// ─── Stored Records (DB shapes) ─────────────────────────────────────

export interface StoredCredential {
  id: string;
  type: CredentialType;
  issuerDid: DIDString;
  subjectDid: DIDString;
  credentialJson: string;
  status: CredentialStatusType;
  issuedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface StoredPresentation {
  id: string;
  holderDid: DIDString;
  verifierDid?: DIDString;
  presentationJson: string;
  credentialIds: string;
  createdAt: string;
}

export interface StoredAnchor {
  id: string;
  eventType: DIDEventType;
  did: DIDString;
  dataHash: string;
  celestiaHeight?: number;
  celestiaTxHash?: string;
  celestiaNamespace?: string;
  celestiaCommitment?: string;
  anchoredAt: string;
}
