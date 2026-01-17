/**
 * IPLD Receipt Types
 * Canonical receipt format for content-addressed inference records.
 */

export type ReceiptSignatureAlgorithm =
  | "eip191"
  | "eip712"
  | "ed25519"
  | "secp256k1";

export interface IpldInferenceReceipt {
  v: 1;
  type: "inference-receipt";
  issuer: string;
  payer: string;
  model: {
    id: string;
    hash?: string;
  };
  data: {
    hash: string;
  };
  prompt: {
    hash: string;
  };
  output?: {
    hash: string;
  };
  license?: {
    id?: string;
    scope?: string;
  };
  payment: {
    chain: "eip155:137";
    currency: "USDC";
    tx?: string;
    amount?: string;
  };
  ts: number;
  sig?: {
    alg: ReceiptSignatureAlgorithm;
    value: string;
  };
}

export interface IpldInferenceReceiptInput {
  issuer: string;
  payer: string;
  modelId: string;
  modelHash?: string;
  dataHash: string;
  promptHash: string;
  outputHash?: string;
  licenseId?: string;
  licenseScope?: string;
  paymentTxHash?: string;
  paymentAmount?: string;
  signatureAlg?: ReceiptSignatureAlgorithm;
  signatureValue?: string;
  timestamp?: number;
}

export interface IpldReceiptRecord {
  cid: string;
  receipt: IpldInferenceReceipt;
  createdAt: number;
  jsonPath: string;
  cborPath: string;
}
