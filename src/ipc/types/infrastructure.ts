import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

/**
 * Contracts for the infrastructure monitor.
 *
 * The shapes are deliberately generic. There is no field naming a product and
 * no enum of known services, because the dashboard renders whatever discovery
 * found and must keep working when something new appears.
 */

export const DiscoveredServiceSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string(),
  type: z.string(),
  sources: z.array(z.string()),
  processName: z.string().optional(),
  pid: z.number().optional(),
  protocol: z.string().optional(),
  host: z.string().optional(),
  port: z.number().optional(),
  url: z.string().optional(),
  containerId: z.string().optional(),
  containerImage: z.string().optional(),
  systemServiceName: z.string().optional(),
  discoveredAt: z.number(),
  lastSeenAt: z.number(),
  status: z.enum(["healthy", "degraded", "offline", "unknown"]),
  latencyMs: z.number().optional(),
  identifiedBy: z.string().optional(),
  metadata: z.record(z.string(), z.string()),
});

export type DiscoveredServiceDto = z.infer<typeof DiscoveredServiceSchema>;

export const InfrastructureSnapshotSchema = z.object({
  node: z.object({
    id: z.string(),
    name: z.string(),
    platform: z.string(),
    lastSeenAt: z.number(),
    reachable: z.boolean(),
  }),
  services: z.array(DiscoveredServiceSchema),
  events: z.array(
    z.object({
      kind: z.string(),
      at: z.number(),
      nodeId: z.string(),
      serviceId: z.string().optional(),
      message: z.string(),
    }),
  ),
  providers: z.array(
    z.object({
      source: z.string(),
      label: z.string(),
      available: z.boolean(),
      found: z.number(),
    }),
  ),
  lastScanAt: z.number().nullable(),
  summary: z.object({
    total: z.number(),
    healthy: z.number(),
    degraded: z.number(),
    offline: z.number(),
    unknown: z.number(),
    identified: z.number(),
  }),
});

export const infrastructureContracts = {
  snapshot: defineContract({
    channel: "infrastructure:snapshot",
    input: z.void(),
    output: InfrastructureSnapshotSchema,
  }),
  scan: defineContract({
    channel: "infrastructure:scan",
    input: z.void(),
    output: InfrastructureSnapshotSchema,
  }),
};

export const infrastructureClient = createClient(infrastructureContracts);
