/**
 * Celestia Anchor Service
 *
 * Anchors DID lifecycle events and credential hashes to Celestia's
 * data availability layer for timestamped, tamper-evident proof.
 * Uses the existing CelestiaBlobService for blob submission.
 */

import * as crypto from "crypto";
import log from "electron-log";
import { db } from "@/db";
import { ssiAnchorLog } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { celestiaBlobService } from "@/lib/celestia_blob_service";

import type {
  DIDString,
  DIDEvent,
  DIDEventType,
  CelestiaAnchor,
  StoredAnchor,
} from "@/types/ssi_types";

const logger = log.scope("ssi_anchor");

// =============================================================================
// CELESTIA ANCHOR SERVICE
// =============================================================================

class CelestiaAnchorService {
  /**
   * Anchor a DID event to Celestia DA layer.
   * Creates a content-addressed blob containing the event data.
   */
  async anchorDIDEvent(event: DIDEvent): Promise<CelestiaAnchor> {
    const eventPayload = JSON.stringify({
      type: event.type,
      did: event.did,
      timestamp: event.timestamp,
      description: event.description,
      dataHash: event.dataHash,
      metadata: event.metadata,
    });

    const dataHash = crypto
      .createHash("sha256")
      .update(eventPayload)
      .digest("hex");

    try {
      const submission = await celestiaBlobService.submitBlob(
        Buffer.from(eventPayload),
        {
          label: `ssi:${event.type}:${event.did}`,
          dataType: "ssi-event",
        },
      );

      const anchor: CelestiaAnchor = {
        height: submission.height,
        namespace: submission.namespace,
        contentHash: submission.contentHash,
        commitment: submission.commitment,
        anchoredAt: new Date().toISOString(),
      };

      // Record in anchor log
      await db.insert(ssiAnchorLog).values({
        id: crypto.randomUUID(),
        eventType: event.type,
        did: event.did,
        dataHash,
        celestiaHeight: submission.height,
        celestiaTxHash: null,
        celestiaNamespace: submission.namespace,
        celestiaCommitment: submission.commitment,
        anchoredAt: new Date(),
      });

      logger.info(
        `Anchored ${event.type} for ${event.did} at height ${submission.height}`,
      );
      return anchor;
    } catch (error) {
      // If Celestia node is not available, store as pending anchor
      logger.warn(`Celestia anchoring failed, storing locally: ${error}`);

      await db.insert(ssiAnchorLog).values({
        id: crypto.randomUUID(),
        eventType: event.type,
        did: event.did,
        dataHash,
        celestiaHeight: null,
        celestiaTxHash: null,
        celestiaNamespace: null,
        celestiaCommitment: null,
        anchoredAt: new Date(),
      });

      return {
        height: 0,
        namespace: "",
        contentHash: dataHash,
        anchoredAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Anchor a credential issuance hash.
   */
  async anchorCredential(
    credentialId: string,
    issuerDid: DIDString,
    credentialHash: string,
  ): Promise<CelestiaAnchor> {
    return this.anchorDIDEvent({
      id: crypto.randomUUID(),
      type: "credential-issued",
      did: issuerDid,
      timestamp: new Date().toISOString(),
      description: `Credential ${credentialId} issued`,
      dataHash: credentialHash,
    });
  }

  /**
   * Verify an anchor against Celestia DA layer.
   */
  async verifyAnchor(
    anchor: CelestiaAnchor,
  ): Promise<{ valid: boolean; timestamp?: string }> {
    if (!anchor.height || anchor.height === 0) {
      return { valid: false };
    }

    try {
      const result = await celestiaBlobService.getBlobByHash(anchor.contentHash);
      if (!result) {
        return { valid: false };
      }

      return {
        valid: result.verified,
        timestamp: anchor.anchoredAt,
      };
    } catch (error) {
      logger.warn(`Anchor verification failed: ${error}`);
      return { valid: false };
    }
  }

  /**
   * Get anchor history for a specific DID.
   */
  async getAnchorHistory(
    did: DIDString,
    limit = 50,
    offset = 0,
  ): Promise<StoredAnchor[]> {
    const rows = await db
      .select()
      .from(ssiAnchorLog)
      .where(eq(ssiAnchorLog.did, did))
      .orderBy(desc(ssiAnchorLog.anchoredAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({
      id: r.id,
      eventType: r.eventType as DIDEventType,
      did: r.did as DIDString,
      dataHash: r.dataHash,
      celestiaHeight: r.celestiaHeight ?? undefined,
      celestiaTxHash: r.celestiaTxHash ?? undefined,
      celestiaNamespace: r.celestiaNamespace ?? undefined,
      celestiaCommitment: r.celestiaCommitment ?? undefined,
      anchoredAt:
        r.anchoredAt instanceof Date
          ? r.anchoredAt.toISOString()
          : new Date((r.anchoredAt as unknown as number) * 1000).toISOString(),
    }));
  }

  /**
   * Get all anchor records (across all DIDs).
   */
  async getAllAnchors(limit = 100): Promise<StoredAnchor[]> {
    const rows = await db
      .select()
      .from(ssiAnchorLog)
      .orderBy(desc(ssiAnchorLog.anchoredAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      eventType: r.eventType as DIDEventType,
      did: r.did as DIDString,
      dataHash: r.dataHash,
      celestiaHeight: r.celestiaHeight ?? undefined,
      celestiaTxHash: r.celestiaTxHash ?? undefined,
      celestiaNamespace: r.celestiaNamespace ?? undefined,
      celestiaCommitment: r.celestiaCommitment ?? undefined,
      anchoredAt:
        r.anchoredAt instanceof Date
          ? r.anchoredAt.toISOString()
          : new Date((r.anchoredAt as unknown as number) * 1000).toISOString(),
    }));
  }
}

export const celestiaAnchorService = new CelestiaAnchorService();
