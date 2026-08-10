import { describe, expect, it } from "vitest";

import {
  applyRetention,
  candidateKey,
  describeUnidentified,
  mergeCandidates,
  reconcile,
  summarise,
} from "@/lib/infrastructure/inventory";
import { identify, selectProbe } from "@/lib/infrastructure/identify";
import type {
  DiscoveredService,
  ServiceCandidate,
} from "@/lib/infrastructure/types";

const NOW = 1_000_000;

const candidate = (over: Partial<ServiceCandidate> = {}): ServiceCandidate => ({
  source: "port",
  ...over,
});

describe("merging sightings", () => {
  it("treats the same port seen by two providers as one service", () => {
    // The dashboard must match reality: one thing listening is one row.
    const services = mergeCandidates(
      "node",
      [
        candidate({ source: "port", port: 6333, pid: 42 }),
        candidate({
          source: "process",
          port: 6333,
          processName: "some-daemon",
        }),
      ],
      NOW,
    );
    expect(services).toHaveLength(1);
    expect(services[0]!.sources).toEqual(["port", "process"]);
  });

  it("unions what each provider knows", () => {
    // No single provider sees the whole picture.
    const services = mergeCandidates(
      "node",
      [
        candidate({ source: "port", port: 5432 }),
        candidate({
          source: "docker",
          port: 5432,
          containerId: "abc123",
          containerImage: "some/image:1",
        }),
      ],
      NOW,
    );
    expect(services[0]!.containerId).toBe("abc123");
    expect(services[0]!.port).toBe(5432);
  });

  it("keeps a process that is not listening on anything", () => {
    // Background workers are part of the inventory too.
    const services = mergeCandidates(
      "node",
      [candidate({ source: "process", pid: 99, processName: "worker" })],
      NOW,
    );
    expect(services).toHaveLength(1);
    expect(services[0]!.name).toBe("worker");
  });

  it("puts listening services above background processes", () => {
    const services = mergeCandidates(
      "node",
      [
        candidate({ source: "process", pid: 1, processName: "background" }),
        candidate({ source: "port", port: 3000 }),
      ],
      NOW,
    );
    expect(services[0]!.port).toBe(3000);
  });
});

describe("naming what nothing recognises", () => {
  it("never produces a bare Unknown", () => {
    // A row called "Unknown" is a row people scroll past.
    expect(describeUnidentified({ port: 8087 })).toBe(
      "Unknown service on :8087",
    );
  });

  it("prefers the process and port together", () => {
    expect(
      describeUnidentified({ processName: "my-service", port: 8087 }),
    ).toBe("my-service on :8087");
  });

  it("does not guess an identity from a port number alone", () => {
    // A port-to-product table would be a service registry by another name,
    // and anything can listen on any port.
    expect(describeUnidentified({ port: 5432 })).toBe(
      "Unknown service on :5432",
    );
  });

  it("uses a container image when that is all there is", () => {
    expect(describeUnidentified({ containerImage: "ghcr.io/x/y:2" })).toBe(
      "ghcr.io/x/y:2",
    );
  });
});

describe("identification is optional", () => {
  const base = (over: Partial<DiscoveredService> = {}): DiscoveredService => ({
    id: "s",
    nodeId: "n",
    name: "Unknown service on :9999",
    type: "network-service",
    sources: ["port"],
    port: 9999,
    host: "127.0.0.1",
    discoveredAt: NOW,
    lastSeenAt: NOW,
    status: "unknown",
    metadata: {},
    ...over,
  });

  it("leaves an unrecognised service exactly as discovered", () => {
    const service = identify(base());
    expect(service.identifiedBy).toBeUndefined();
    expect(service.name).toBe("Unknown service on :9999");
  });

  it("still gives an unrecognised service a real probe", () => {
    // The whole point: monitoring does not require recognition.
    expect(selectProbe(base())).toEqual({
      kind: "tcp",
      host: "127.0.0.1",
      port: 9999,
    });
  });

  it("enriches when a plugin matches", () => {
    const service = identify(base({ processName: "qdrant", port: 6333 }));
    expect(service.identifiedBy).toBe("qdrant");
    expect(service.name).toBe("Qdrant");
  });

  it("works with every plugin removed", () => {
    // If deleting the plugins broke discovery, they would not be optional.
    const service = identify(base({ processName: "qdrant" }), []);
    expect(service.identifiedBy).toBeUndefined();
    expect(selectProbe(service, []).kind).toBe("tcp");
  });

  it("does not claim an identity from a port number alone", () => {
    // Anything can listen on 6379; a confident wrong label is worse than none.
    const service = identify(base({ port: 6379, processName: "my-app" }));
    expect(service.identifiedBy).toBeUndefined();
  });

  it("survives a plugin that throws", () => {
    const broken = [
      {
        id: "broken",
        priority: 99,
        name: "X",
        type: "x",
        matches: () => {
          throw new Error("bad plugin");
        },
      },
    ];
    expect(() => identify(base(), broken)).not.toThrow();
  });
});

describe("probe selection", () => {
  const svc = (over: Partial<DiscoveredService>): DiscoveredService => ({
    id: "s",
    nodeId: "n",
    name: "x",
    type: "t",
    sources: ["port"],
    discoveredAt: NOW,
    lastSeenAt: NOW,
    status: "unknown",
    metadata: {},
    ...over,
  });

  it("asks for an advertised health path when one is known", () => {
    const probe = selectProbe(
      svc({ port: 8080, host: "h", metadata: { healthPath: "/health" } }),
    );
    expect(probe).toEqual({
      kind: "http",
      url: "http://h:8080/health",
      method: "GET",
    });
  });

  it("falls back to HEAD for an HTTP service with no health path", () => {
    const probe = selectProbe(svc({ port: 80, host: "h", protocol: "http" }));
    expect(probe).toMatchObject({ kind: "http", method: "HEAD" });
  });

  it("falls back to a connection test for anything else", () => {
    expect(selectProbe(svc({ port: 9092, host: "h" })).kind).toBe("tcp");
  });

  it("uses the container when there is no port", () => {
    expect(selectProbe(svc({ containerId: "c1" })).kind).toBe("docker");
  });

  it("says plainly when there is nothing to probe", () => {
    expect(selectProbe(svc({})).kind).toBe("none");
  });
});

describe("reconciling across scans", () => {
  const service = (over: Partial<DiscoveredService> = {}): DiscoveredService =>
    ({
      id: "n:port:127.0.0.1:3000",
      nodeId: "n",
      name: "svc",
      type: "network-service",
      sources: ["port"],
      port: 3000,
      discoveredAt: NOW,
      lastSeenAt: NOW,
      status: "healthy",
      metadata: {},
      ...over,
    }) as DiscoveredService;

  it("announces a service the first time it appears", () => {
    const { events } = reconcile([], [service()], NOW);
    expect(events[0]!.kind).toBe("SERVICE_DISCOVERED");
  });

  it("marks a vanished service offline rather than deleting it", () => {
    // A service disappearing is the most interesting thing a monitor can say.
    const { services, events } = reconcile([service()], [], NOW + 1);
    expect(services[0]!.status).toBe("offline");
    expect(events[0]!.kind).toBe("SERVICE_LOST");
  });

  it("reports a recovery when it comes back", () => {
    const { events } = reconcile(
      [service({ status: "offline" })],
      [service()],
      NOW + 2,
    );
    expect(events[0]!.kind).toBe("SERVICE_RECOVERED");
  });

  it("keeps the original discovery time, so uptime means something", () => {
    const { services } = reconcile(
      [service({ discoveredAt: 5 })],
      [service({ discoveredAt: NOW })],
      NOW,
    );
    expect(services[0]!.discoveredAt).toBe(5);
  });

  it("keeps an identification already made", () => {
    const { services } = reconcile(
      [service({ identifiedBy: "qdrant", name: "Qdrant" })],
      [service({ name: "Unknown service on :3000" })],
      NOW,
    );
    expect(services[0]!.name).toBe("Qdrant");
  });

  it("drops an offline service only after the retention window", () => {
    const gone = service({ status: "offline", lastSeenAt: NOW });
    expect(applyRetention([gone], NOW + 500, 1000)).toHaveLength(1);
    expect(applyRetention([gone], NOW + 5000, 1000)).toHaveLength(0);
  });
});

describe("summarise", () => {
  it("counts by status for the header", () => {
    const make = (status: DiscoveredService["status"]) =>
      ({ status, metadata: {} }) as DiscoveredService;
    const counts = summarise([
      make("healthy"),
      make("healthy"),
      make("degraded"),
      make("offline"),
    ]);
    expect(counts).toMatchObject({
      total: 4,
      healthy: 2,
      degraded: 1,
      offline: 1,
    });
  });
});

describe("candidateKey", () => {
  it("identifies by host and port when listening", () => {
    expect(candidateKey(candidate({ port: 80, host: "h" }))).toBe("port:h:80");
  });

  it("falls back through container, unit, then pid", () => {
    expect(candidateKey(candidate({ containerId: "c" }))).toBe("container:c");
    expect(candidateKey(candidate({ systemServiceName: "u" }))).toBe("unit:u");
    expect(candidateKey(candidate({ pid: 7 }))).toBe("pid:7");
  });
});
