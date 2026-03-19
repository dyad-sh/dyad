/**
 * Model Registry Discovery — Peer Announcement & Discovery via GossipSub
 * ======================================================================
 * When running, listens on the "joycreate/model-registry/v1" GossipSub topic
 * for model announcements from peers, and publishes local models.
 *
 * This is a thin layer that connects the ModelRegistryService with the
 * compute network's libp2p node.  When the compute network isn't started,
 * discovery is purely local (no-op).
 */

import log from "electron-log";
import {
  ingestPeerModel,
  upsertPeer,
  listLocalModels,
  markOfflinePeers,
} from "@/lib/model_registry_service";

const logger = log.scope("model_registry_discovery");

const TOPIC = "joycreate/model-registry/v1";

let libp2pNode: any = null;
let discoveryInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start model registry discovery.
 * Subscribes to GossipSub topic and begins periodic announcements.
 */
export async function startDiscovery(p2pNode: any): Promise<void> {
  if (!p2pNode) {
    logger.warn("No libp2p node provided — running in local-only mode");
    return;
  }

  libp2pNode = p2pNode;

  try {
    // Subscribe to model announcements
    const pubsub = libp2pNode.services?.pubsub;
    if (!pubsub) {
      logger.warn("libp2p node has no pubsub service — discovery disabled");
      return;
    }

    pubsub.subscribe(TOPIC);
    pubsub.addEventListener("message", handlePeerMessage);

    // Announce our local models every 10 minutes
    discoveryInterval = setInterval(announceLocalModels, 10 * 60 * 1000);

    // Mark stale peers every 15 minutes
    setInterval(() => {
      markOfflinePeers(30).catch((err) =>
        logger.warn("Failed to mark offline peers:", err),
      );
    }, 15 * 60 * 1000);

    // Initial announcement after a short delay
    setTimeout(announceLocalModels, 5000);

    logger.info("Model registry discovery started on topic:", TOPIC);
  } catch (err) {
    logger.error("Failed to start model registry discovery:", err);
  }
}

/**
 * Stop discovery and clean up.
 */
export function stopDiscovery(): void {
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
    discoveryInterval = null;
  }

  if (libp2pNode?.services?.pubsub) {
    try {
      libp2pNode.services.pubsub.removeEventListener("message", handlePeerMessage);
      libp2pNode.services.pubsub.unsubscribe(TOPIC);
    } catch {
      // ignore unsubscribe errors on shutdown
    }
  }

  libp2pNode = null;
  logger.info("Model registry discovery stopped");
}

/**
 * Announce all locally published models to the network.
 */
async function announceLocalModels(): Promise<void> {
  if (!libp2pNode?.services?.pubsub) return;

  try {
    const localModels = await listLocalModels();
    const publishedModels = localModels.filter(
      (m) => m.publishState === "published" || m.publishState === "pinned",
    );

    if (publishedModels.length === 0) return;

    const peerId = libp2pNode.peerId?.toString() || "unknown";

    for (const model of publishedModels) {
      const announcement = {
        type: "model_announcement",
        peerId,
        model: {
          name: model.name,
          description: model.description,
          version: model.version,
          family: model.family,
          author: model.author,
          modelType: model.modelType,
          contentHash: model.contentHash,
          bundleCid: model.bundleCid,
          manifestCid: model.manifestCid,
          celestiaHeight: model.celestiaHeight,
          celestiaCommitment: model.celestiaCommitment,
          parameters: model.parameters,
          contextLength: model.contextLength,
          fileSizeBytes: model.fileSizeBytes,
          format: model.format,
          capabilities: model.capabilities,
          license: model.license,
          tags: model.tags,
          avgRating: model.avgRating,
        },
        timestamp: Date.now(),
      };

      const data = new TextEncoder().encode(JSON.stringify(announcement));
      await libp2pNode.services.pubsub.publish(TOPIC, data);
    }

    logger.debug(`Announced ${publishedModels.length} models to network`);
  } catch (err) {
    logger.warn("Failed to announce models:", err);
  }
}

/**
 * Handle incoming model announcements from peers.
 */
async function handlePeerMessage(evt: any): Promise<void> {
  if (evt.detail?.topic !== TOPIC) return;

  try {
    const raw = new TextDecoder().decode(evt.detail.data);

    // Limit message size to prevent abuse
    if (raw.length > 50_000) {
      logger.warn("Ignoring oversized peer message");
      return;
    }

    const message = JSON.parse(raw);
    if (message.type !== "model_announcement") return;
    if (!message.peerId || !message.model) return;

    const peerId = String(message.peerId);
    const model = message.model;

    // Validate required fields
    if (!model.name || !model.contentHash || !model.version) {
      logger.debug("Skipping incomplete model announcement");
      return;
    }

    // Register the peer
    await upsertPeer({
      peerId,
      modelsShared: 1,
    });

    // Ingest the model
    await ingestPeerModel({
      peerId,
      name: String(model.name),
      description: model.description ? String(model.description) : undefined,
      version: String(model.version),
      family: String(model.family || "unknown"),
      author: String(model.author || "unknown"),
      modelType: model.modelType || "base",
      contentHash: String(model.contentHash),
      bundleCid: model.bundleCid ? String(model.bundleCid) : undefined,
      manifestCid: model.manifestCid ? String(model.manifestCid) : undefined,
      celestiaHeight: model.celestiaHeight,
      celestiaCommitment: model.celestiaCommitment
        ? String(model.celestiaCommitment)
        : undefined,
      parameters: model.parameters,
      contextLength: model.contextLength,
      fileSizeBytes: model.fileSizeBytes,
      format: model.format ? String(model.format) : undefined,
      capabilities: model.capabilities,
      license: model.license ? String(model.license) : undefined,
      tags: Array.isArray(model.tags) ? model.tags.map(String) : undefined,
      rating: model.avgRating,
    });

    logger.debug(`Ingested model from peer ${peerId}: ${model.name}`);
  } catch (err) {
    logger.warn("Failed to process peer model announcement:", err);
  }
}

/**
 * Manually request model announcements from connected peers.
 * Useful when first joining the network.
 */
export async function requestModelCatalog(): Promise<void> {
  if (!libp2pNode?.services?.pubsub) return;

  const request = {
    type: "catalog_request",
    peerId: libp2pNode.peerId?.toString() || "unknown",
    timestamp: Date.now(),
  };

  const data = new TextEncoder().encode(JSON.stringify(request));
  await libp2pNode.services.pubsub.publish(TOPIC, data);
  logger.info("Requested model catalog from peers");
}
