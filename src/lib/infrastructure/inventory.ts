import type {
  DiscoveredService,
  DiscoveryEvent,
  ServiceCandidate,
} from "./types";

/**
 * Turning sightings into an inventory.
 *
 * Pure, so the merge rules can be tested against awkward combinations without
 * a machine that happens to be running the right things.
 *
 * Two decisions matter most here. A service seen by three providers is one
 * service, not three, and merging them is what makes the dashboard match
 * reality. And a service nobody recognises still gets a name, a row and a
 * probe, because an inventory that only lists what it recognises is an
 * inventory that hides exactly the thing you were looking for.
 */

/**
 * The identity of a sighting.
 *
 * Port on a host is the strongest signal, because that is what a client would
 * connect to. A container or process without a port is still worth listing, so
 * they fall back to their own identifiers rather than being dropped.
 */
export function candidateKey(candidate: ServiceCandidate): string {
  if (candidate.port !== undefined) {
    return `port:${candidate.host ?? "127.0.0.1"}:${candidate.port}`;
  }
  if (candidate.containerId) return `container:${candidate.containerId}`;
  if (candidate.systemServiceName) {
    return `unit:${candidate.systemServiceName}`;
  }
  if (candidate.pid !== undefined) return `pid:${candidate.pid}`;
  return `unknown:${candidate.source}:${candidate.processName ?? "?"}`;
}

/**
 * A readable name for something nothing has identified.
 *
 * Built from whatever is actually known, in descending order of how much it
 * tells a person. The result is never "Unknown": a bare "Unknown" is what
 * makes people ignore a row, where "Unknown HTTP service on :8087
 * (my-service)" is something they can act on.
 */
export function describeUnidentified(candidate: {
  processName?: string;
  port?: number;
  containerImage?: string;
  systemServiceName?: string;
  suggestedName?: string;
  protocol?: string;
}): string {
  if (candidate.suggestedName) return candidate.suggestedName;
  if (candidate.systemServiceName) return candidate.systemServiceName;
  if (candidate.containerImage) return candidate.containerImage;
  if (candidate.processName && candidate.port !== undefined) {
    return `${candidate.processName} on :${candidate.port}`;
  }
  if (candidate.processName) return candidate.processName;

  // Deliberately no port-to-product table here. A guess based only on a port
  // number would be a service registry by another name, and anything can
  // listen anywhere. The plugins name what they recognise; this stays honest.
  if (candidate.port !== undefined) {
    return `Unknown service on :${candidate.port}`;
  }
  return "Unknown service";
}

/**
 * Merges every sighting of one thing into a single service.
 *
 * Fields are filled from whichever candidate knows them: the port scanner
 * knows the port, Docker knows the image, the process list knows the command.
 * None of them knows everything, and the union is the only complete picture.
 */
export function mergeCandidates(
  nodeId: string,
  candidates: ServiceCandidate[],
  now: number,
): DiscoveredService[] {
  const grouped = new Map<string, ServiceCandidate[]>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }

  const services: DiscoveredService[] = [];

  for (const [key, group] of grouped) {
    const first = <T>(pick: (c: ServiceCandidate) => T | undefined) => {
      for (const candidate of group) {
        const value = pick(candidate);
        if (value !== undefined && value !== "") return value;
      }
      return undefined;
    };

    const metadata: Record<string, string> = {};
    for (const candidate of group) {
      Object.assign(metadata, candidate.metadata ?? {});
    }

    const port = first((c) => c.port);
    const host = first((c) => c.host) ?? "127.0.0.1";
    const protocol = first((c) => c.protocol);

    services.push({
      id: `${nodeId}:${key}`,
      nodeId,
      name: describeUnidentified({
        suggestedName: first((c) => c.suggestedName),
        systemServiceName: first((c) => c.systemServiceName),
        containerImage: first((c) => c.containerImage),
        processName: first((c) => c.processName),
        port,
        protocol,
      }),
      // Deliberately generic until an identifier says otherwise.
      type: port !== undefined ? "network-service" : "process",
      sources: [...new Set(group.map((c) => c.source))],
      processName: first((c) => c.processName),
      pid: first((c) => c.pid),
      protocol,
      host,
      port,
      containerId: first((c) => c.containerId),
      containerImage: first((c) => c.containerImage),
      systemServiceName: first((c) => c.systemServiceName),
      discoveredAt: now,
      lastSeenAt: now,
      status: "unknown",
      metadata,
    });
  }

  // Listening services first, then by port, so the things you can actually
  // connect to lead and background processes settle underneath.
  return services.sort((a, b) => {
    if ((a.port === undefined) !== (b.port === undefined)) {
      return a.port === undefined ? 1 : -1;
    }
    if (a.port !== undefined && b.port !== undefined && a.port !== b.port) {
      return a.port - b.port;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Carries forward what a previous scan already knew.
 *
 * `discoveredAt` survives so "running since" means something, and a service
 * that has gone is marked offline rather than deleted, because a service
 * vanishing is the single most interesting thing a monitor can tell you and
 * silently dropping the row is how that news gets lost.
 */
export function reconcile(
  previous: DiscoveredService[],
  current: DiscoveredService[],
  now: number,
): { services: DiscoveredService[]; events: DiscoveryEvent[] } {
  const before = new Map(previous.map((service) => [service.id, service]));
  const events: DiscoveryEvent[] = [];
  const merged: DiscoveredService[] = [];

  for (const service of current) {
    const known = before.get(service.id);
    if (!known) {
      events.push({
        kind: "SERVICE_DISCOVERED",
        at: now,
        nodeId: service.nodeId,
        serviceId: service.id,
        message: `Discovered ${service.name}`,
      });
      merged.push(service);
      continue;
    }

    if (known.status === "offline") {
      events.push({
        kind: "SERVICE_RECOVERED",
        at: now,
        nodeId: service.nodeId,
        serviceId: service.id,
        message: `${service.name} is back`,
      });
    }

    merged.push({
      ...service,
      discoveredAt: known.discoveredAt,
      // An identification already made is kept: identifying is expensive and
      // the answer does not change while the service is the same one.
      identifiedBy: known.identifiedBy ?? service.identifiedBy,
      name: known.identifiedBy ? known.name : service.name,
      type: known.identifiedBy ? known.type : service.type,
    });
  }

  const seen = new Set(current.map((service) => service.id));
  for (const service of previous) {
    if (seen.has(service.id)) continue;
    if (service.status !== "offline") {
      events.push({
        kind: "SERVICE_LOST",
        at: now,
        nodeId: service.nodeId,
        serviceId: service.id,
        message: `${service.name} is no longer running`,
      });
    }
    merged.push({ ...service, status: "offline" });
  }

  return { services: merged, events };
}

/**
 * Drops services that have been gone long enough to stop being news.
 *
 * Retention is a parameter rather than a constant so it can be configured
 * without touching this logic.
 */
export function applyRetention(
  services: DiscoveredService[],
  now: number,
  retentionMs: number,
): DiscoveredService[] {
  return services.filter(
    (service) =>
      service.status !== "offline" || now - service.lastSeenAt < retentionMs,
  );
}

/** Counts for the dashboard header, derived rather than tracked separately. */
export function summarise(services: DiscoveredService[]) {
  return {
    total: services.length,
    healthy: services.filter((s) => s.status === "healthy").length,
    degraded: services.filter((s) => s.status === "degraded").length,
    offline: services.filter((s) => s.status === "offline").length,
    unknown: services.filter((s) => s.status === "unknown").length,
    identified: services.filter((s) => s.identifiedBy).length,
  };
}
