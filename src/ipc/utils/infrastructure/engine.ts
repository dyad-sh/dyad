import { identify, selectProbe } from "@/lib/infrastructure/identify";
import {
  applyRetention,
  mergeCandidates,
  reconcile,
  summarise,
} from "@/lib/infrastructure/inventory";
import type {
  DiscoveredService,
  DiscoveryEvent,
  DiscoveryProvider,
  MonitoredNode,
  ServiceCandidate,
} from "@/lib/infrastructure/types";
import {
  LOCAL_PROVIDERS,
  infrastructureLogger as logger,
  localNode,
  runProbe,
} from "./providers";

/**
 * The discovery pipeline, run end to end.
 *
 * Node → providers → candidates → merge → identify → probe → inventory.
 *
 * State is held here across scans so the monitor can say what changed rather
 * than only what is. Everything is in memory: an inventory is a description of
 * this moment, and persisting it would mean showing people a picture of a
 * machine as it was when the app last closed.
 */

/** Offline services are kept this long so a restart is visible as a story. */
const RETENTION_MS = 15 * 60 * 1000;

/** Probing every process would be pointless and slow; only endpoints matter. */
const MAX_PROBES_PER_SCAN = 60;

type EngineState = {
  services: DiscoveredService[];
  events: DiscoveryEvent[];
  providers: {
    source: string;
    label: string;
    available: boolean;
    found: number;
  }[];
  lastScanAt: number | null;
  scanning: boolean;
};

const state: EngineState = {
  services: [],
  events: [],
  providers: [],
  lastScanAt: null,
  scanning: false,
};

/** Newest first, and bounded: a timeline nobody can scroll is not a timeline. */
const MAX_EVENTS = 200;

function record(events: DiscoveryEvent[]) {
  state.events = [...events, ...state.events].slice(0, MAX_EVENTS);
}

/**
 * One full pass.
 *
 * Providers run in parallel and independently: one that hangs or throws costs
 * its own results, never the whole scan, because a machine without Docker
 * should still show its ports.
 */
export async function scan(
  providers: DiscoveryProvider[] = LOCAL_PROVIDERS,
): Promise<{
  node: MonitoredNode;
  services: DiscoveredService[];
  events: DiscoveryEvent[];
}> {
  if (state.scanning) {
    return {
      node: localNode(),
      services: state.services,
      events: state.events,
    };
  }
  state.scanning = true;

  try {
    const node = localNode();
    const now = Date.now();

    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          if (!(await provider.available())) {
            return { provider, available: false, candidates: [] };
          }
          return {
            provider,
            available: true,
            candidates: await provider.discover(),
          };
        } catch (error) {
          logger.warn(
            `Provider ${provider.source} failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
          return { provider, available: true, candidates: [] };
        }
      }),
    );

    state.providers = results.map((result) => ({
      source: result.provider.source,
      label: result.provider.label,
      available: result.available,
      found: result.candidates.length,
    }));

    const candidates: ServiceCandidate[] = results.flatMap(
      (result) => result.candidates,
    );

    // Merge, then enrich. Identification runs after merging so a plugin sees
    // everything known about a service rather than one provider's fragment.
    const merged = mergeCandidates(node.id, candidates, now).map((service) =>
      identify(service),
    );

    const { services, events } = reconcile(state.services, merged, now);

    // Probe what can be probed, newest endpoints first, bounded so a machine
    // with a thousand processes does not spend a minute checking them.
    const probeable = services
      .filter((service) => service.status !== "offline")
      .filter((service) => service.port !== undefined || service.containerId)
      .slice(0, MAX_PROBES_PER_SCAN);

    const probed = new Map<string, DiscoveredService>();
    await Promise.all(
      probeable.map(async (service) => {
        const result = await runProbe(selectProbe(service));
        probed.set(service.id, {
          ...service,
          status: result.status,
          latencyMs: result.latencyMs,
          lastSeenAt: now,
        });
      }),
    );

    const finalServices = applyRetention(
      services.map((service) => probed.get(service.id) ?? service),
      now,
      RETENTION_MS,
    );

    // Health transitions are their own news, separate from discovery.
    const previousStatus = new Map(
      state.services.map((service) => [service.id, service.status]),
    );
    const healthEvents: DiscoveryEvent[] = [];
    for (const service of finalServices) {
      const before = previousStatus.get(service.id);
      if (before && before !== service.status && service.status !== "unknown") {
        healthEvents.push({
          kind: "SERVICE_HEALTH_CHANGED",
          at: now,
          nodeId: service.nodeId,
          serviceId: service.id,
          message: `${service.name} is now ${service.status}`,
        });
      }
      if (service.identifiedBy && !previousStatus.has(service.id)) {
        healthEvents.push({
          kind: "SERVICE_IDENTIFIED",
          at: now,
          nodeId: service.nodeId,
          serviceId: service.id,
          message: `Identified ${service.name}`,
        });
      }
    }

    state.services = finalServices;
    state.lastScanAt = now;
    record([...events, ...healthEvents]);

    return { node, services: finalServices, events: state.events };
  } finally {
    state.scanning = false;
  }
}

/** The current inventory without rescanning. */
export function snapshot() {
  return {
    node: localNode(),
    services: state.services,
    events: state.events,
    providers: state.providers,
    lastScanAt: state.lastScanAt,
    summary: summarise(state.services),
  };
}
