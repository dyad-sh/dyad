import type { DiscoveredService, HealthProbe } from "./types";

/**
 * Optional enrichment.
 *
 * This is the only file in the monitor permitted to know a product name, and
 * even here the knowledge is a list of plugins rather than branching logic.
 * Delete every entry in `IDENTIFIERS` and the monitor still discovers, probes
 * and displays everything; services simply keep the generic names discovery
 * gave them.
 *
 * That is the test to apply to anything added here: if removing it would hide
 * a service or break a probe, it does not belong in an identifier.
 */

export type ServiceIdentifier = {
  /** Stable id recorded on the service as `identifiedBy`. */
  id: string;
  /** Higher wins when two identifiers both match. */
  priority: number;
  /** Whether this plugin recognises the service. */
  matches: (service: DiscoveredService) => boolean;
  /** The display name to use. */
  name: string;
  /** A coarse category, used only for grouping and icons. */
  type: string;
  /** An optional better probe than the generic one. */
  probe?: (service: DiscoveredService) => HealthProbe | null;
};

/** Does any hint mention this word? Names, images and units all count. */
function mentions(service: DiscoveredService, word: string): boolean {
  const haystack = [
    service.processName,
    service.containerImage,
    service.systemServiceName,
    service.name,
    service.metadata.command,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(word);
}

/**
 * The bundled plugins.
 *
 * Each is a hint, not a requirement. A port number alone is never enough to
 * claim an identity, because anything can listen on any port and a wrong
 * confident label is worse than an honest generic one.
 */
export const IDENTIFIERS: ServiceIdentifier[] = [
  {
    id: "postgres",
    priority: 50,
    name: "PostgreSQL",
    type: "database",
    matches: (service) =>
      mentions(service, "postgres") ||
      (service.port === 5432 && mentions(service, "postgre")),
    probe: (service) =>
      service.port !== undefined
        ? { kind: "tcp", host: service.host ?? "127.0.0.1", port: service.port }
        : null,
  },
  {
    id: "redis",
    priority: 50,
    name: "Redis",
    type: "cache",
    matches: (service) => mentions(service, "redis"),
    probe: (service) =>
      service.port !== undefined
        ? { kind: "tcp", host: service.host ?? "127.0.0.1", port: service.port }
        : null,
  },
  {
    id: "qdrant",
    priority: 50,
    name: "Qdrant",
    type: "vector-database",
    matches: (service) => mentions(service, "qdrant"),
    probe: (service) =>
      service.port !== undefined
        ? {
            kind: "http",
            url: `http://${service.host ?? "127.0.0.1"}:${service.port}/healthz`,
            method: "GET",
          }
        : null,
  },
  {
    id: "ollama",
    priority: 50,
    name: "Ollama",
    type: "model-runtime",
    matches: (service) => mentions(service, "ollama"),
    probe: (service) =>
      service.port !== undefined
        ? {
            kind: "http",
            url: `http://${service.host ?? "127.0.0.1"}:${service.port}/api/tags`,
            method: "GET",
          }
        : null,
  },
  {
    id: "docker-engine",
    priority: 20,
    name: "Docker",
    type: "container-runtime",
    matches: (service) =>
      mentions(service, "dockerd") || mentions(service, "com.docker"),
  },
];

/**
 * Applies the best matching plugin, or leaves the service as discovered.
 *
 * Returning the service unchanged is a first-class outcome, not a failure.
 */
export function identify(
  service: DiscoveredService,
  identifiers: ServiceIdentifier[] = IDENTIFIERS,
): DiscoveredService {
  const match = identifiers
    .filter((identifier) => {
      try {
        return identifier.matches(service);
      } catch {
        // A broken plugin must not take the inventory down with it.
        return false;
      }
    })
    .sort((a, b) => b.priority - a.priority)[0];

  if (!match) return service;

  return {
    ...service,
    name: match.name,
    type: match.type,
    identifiedBy: match.id,
  };
}

/**
 * Chooses how to check a service, from what discovery actually found.
 *
 * The order is from most informative to least: an identifier's own endpoint
 * beats a guess, a guess beats a bare connection, and a bare connection beats
 * nothing. Every branch is driven by the shape of the service rather than by
 * what it is, so an unrecognised service is still probed properly.
 */
export function selectProbe(
  service: DiscoveredService,
  identifiers: ServiceIdentifier[] = IDENTIFIERS,
): HealthProbe {
  const identifier = service.identifiedBy
    ? identifiers.find((each) => each.id === service.identifiedBy)
    : undefined;

  const advertised = identifier?.probe?.(service);
  if (advertised) return advertised;

  const host = service.host ?? "127.0.0.1";

  if (service.port !== undefined) {
    // A service that announced an HTTP health path gets asked for it.
    const healthPath = service.metadata.healthPath;
    if (healthPath) {
      return {
        kind: "http",
        url: `http://${host}:${service.port}${healthPath}`,
        method: "GET",
      };
    }
    // Anything that looks like HTTP answers a HEAD without a body.
    if (service.protocol === "http" || service.protocol === "https") {
      return {
        kind: "http",
        url: `${service.protocol}://${host}:${service.port}/`,
        method: "HEAD",
      };
    }
    // Otherwise the honest question is only whether it accepts a connection.
    return { kind: "tcp", host, port: service.port };
  }

  if (service.containerId) {
    return { kind: "docker", containerId: service.containerId };
  }
  if (service.pid !== undefined) {
    return { kind: "process", pid: service.pid };
  }

  return {
    kind: "none",
    reason: "Nothing to probe: no port, container or pid",
  };
}
