import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

/**
 * A snapshot of the app's own knowledge: projects, conversations, agents,
 * documents and providers, with the relationships that genuinely exist
 * between them.
 */
const GraphNodeSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "core",
    "cluster",
    "project",
    "conversation",
    "agent",
    "document",
    "provider",
  ]),
  label: z.string(),
  clusterId: z.string().nullable(),
  weight: z.number(),
  lastActivityAt: z.number().nullable(),
  conflict: z.boolean().optional(),
  verified: z.boolean().optional(),
  route: z.string().optional(),
  detail: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});

const GraphEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  strength: z.number(),
});

export const KnowledgeGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  generatedAt: z.number(),
});

export const knowledgeGraphContracts = {
  getGraph: defineContract({
    channel: "knowledge-graph:get",
    input: z.void(),
    output: KnowledgeGraphSchema,
  }),
};

export const knowledgeGraphClient = createClient(knowledgeGraphContracts);
