/**
 * IPLD Receipt Service
 * Creates canonical DAG-CBOR receipts and stores them locally.
 */

import path from "node:path";
import fs from "fs-extra";
import { getUserDataPath } from "@/paths/paths";

import type {
  IpldInferenceReceipt,
  IpldInferenceReceiptInput,
  IpldReceiptRecord,
} from "@/types/ipld_receipt";

interface ReceiptIndex {
  [cid: string]: IpldReceiptRecord;
}

let CID: any;
let dagCbor: any;
let sha256: any;

async function loadEsmModules() {
  if (!CID) {
    const cidModule = await import("multiformats/cid");
    CID = cidModule.CID;
  }
  if (!dagCbor) {
    const dagCborModule = await import("@ipld/dag-cbor");
    dagCbor = dagCborModule;
  }
  if (!sha256) {
    const sha256Module = await import("multiformats/hashes/sha2");
    sha256 = sha256Module.sha256;
  }
}

class IpldReceiptService {
  private receiptsPath: string;
  private indexPath: string;

  constructor() {
    this.receiptsPath = path.join(getUserDataPath(), "ipld-receipts");
    this.indexPath = path.join(this.receiptsPath, "index.json");
  }

  private async ensureStorage(): Promise<void> {
    await fs.ensureDir(this.receiptsPath);
  }

  private async loadIndex(): Promise<ReceiptIndex> {
    await this.ensureStorage();
    if (!(await fs.pathExists(this.indexPath))) {
      return {};
    }
    try {
      return (await fs.readJson(this.indexPath)) as ReceiptIndex;
    } catch {
      return {};
    }
  }

  private async saveIndex(index: ReceiptIndex): Promise<void> {
    await this.ensureStorage();
    await fs.writeJson(this.indexPath, index, { spaces: 2 });
  }

  private buildReceipt(
    input: IpldInferenceReceiptInput,
  ): IpldInferenceReceipt {
    const storeName = input.storeName?.trim();
    const creatorId = input.creatorId?.trim();
    const inferredTarget = storeName && creatorId
      ? `${input.modelId}.${storeName}.${creatorId}`
      : undefined;
    const inferenceTarget = input.inferenceTarget || inferredTarget;
    const receipt: IpldInferenceReceipt = {
      v: 1,
      type: "inference-receipt",
      issuer: input.issuer,
      payer: input.payer,
      ...(storeName && creatorId
        ? {
            store: {
              name: storeName,
              creatorId,
            },
          }
        : {}),
      ...(inferenceTarget
        ? {
            inference: {
              target: inferenceTarget,
            },
          }
        : {}),
      model: {
        id: input.modelId,
        ...(input.modelHash ? { hash: input.modelHash } : {}),
      },
      data: {
        hash: input.dataHash,
      },
      prompt: {
        hash: input.promptHash,
      },
      payment: {
        chain: "eip155:137",
        currency: "USDC",
        ...(input.paymentTxHash ? { tx: input.paymentTxHash } : {}),
        ...(input.paymentAmount ? { amount: input.paymentAmount } : {}),
      },
      ts: input.timestamp ?? Date.now(),
    };

    if (input.outputHash) {
      receipt.output = { hash: input.outputHash };
    }

    if (input.licenseId || input.licenseScope) {
      receipt.license = {
        ...(input.licenseId ? { id: input.licenseId } : {}),
        ...(input.licenseScope ? { scope: input.licenseScope } : {}),
      };
    }

    if (input.signatureAlg && input.signatureValue) {
      receipt.sig = {
        alg: input.signatureAlg,
        value: input.signatureValue,
      };
    }

    return receipt;
  }

  async createReceipt(
    input: IpldInferenceReceiptInput,
  ): Promise<IpldReceiptRecord> {
    if (!input.issuer || !input.payer || !input.modelId) {
      throw new Error("Receipt requires issuer, payer, and modelId");
    }
    if (!input.dataHash || !input.promptHash) {
      throw new Error("Receipt requires dataHash and promptHash");
    }

    await loadEsmModules();

    const receipt = this.buildReceipt(input);
    const cborBytes = dagCbor.encode(receipt);
    const hash = await sha256.digest(cborBytes);
    const cid = CID.createV1(dagCbor.code, hash).toString();

    await this.ensureStorage();
    const jsonPath = path.join(this.receiptsPath, `${cid}.json`);
    const cborPath = path.join(this.receiptsPath, `${cid}.cbor`);

    await fs.writeJson(jsonPath, receipt, { spaces: 2 });
    await fs.writeFile(cborPath, Buffer.from(cborBytes));

    const record: IpldReceiptRecord = {
      cid,
      receipt,
      createdAt: Date.now(),
      jsonPath,
      cborPath,
    };

    const index = await this.loadIndex();
    index[cid] = record;
    await this.saveIndex(index);

    return record;
  }

  async listReceipts(): Promise<IpldReceiptRecord[]> {
    const index = await this.loadIndex();
    return Object.values(index).sort((a, b) => b.createdAt - a.createdAt);
  }

  async getReceipt(cid: string): Promise<IpldReceiptRecord | null> {
    const index = await this.loadIndex();
    return index[cid] ?? null;
  }

  async verifyReceipt(cid: string): Promise<{ valid: boolean; computedCid: string }> {
    await loadEsmModules();
    const record = await this.getReceipt(cid);
    if (!record) {
      throw new Error("Receipt not found");
    }
    const cborBytes = dagCbor.encode(record.receipt);
    const hash = await sha256.digest(cborBytes);
    const computedCid = CID.createV1(dagCbor.code, hash).toString();
    return { valid: computedCid === cid, computedCid };
  }
}

export const ipldReceiptService = new IpldReceiptService();
