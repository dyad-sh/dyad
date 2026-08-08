import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { desc, sql } from "drizzle-orm";

import { db } from "@/db";
import { agentOsAgents, apps, chats, messages } from "@/db/schema";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";
import { vaultDocumentsPath } from "../utils/storage_vault";
import { createTypedHandler } from "./base";
import { knowledgeGraphContracts } from "../types/knowledge_graph";
import {
  weightFromCount,
  type GraphEdge,
  type GraphNode,
} from "@/lib/knowledge/graph_model";

const logger = log.scope("knowledge_graph");

/** Cluster hubs the core orbits. Each holds one kind of real thing. */
const CLUSTERS: { id: string; label: string }[] = [
  { id: "cluster-projects", label: "Projects" },
  { id: "cluster-conversations", label: "Conversations" },
  { id: "cluster-agents", label: "Agents" },
  { id: "cluster-documents", label: "Documents" },
  { id: "cluster-providers", label: "Models" },
];

const MAX_PER_CLUSTER = 40;

export function registerKnowledgeGraphHandlers() {
  createTypedHandler(knowledgeGraphContracts.getGraph, async () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    nodes.push({
      id: "core",
      kind: "core",
      label: "Meta Human Core",
      clusterId: null,
      weight: 1,
      lastActivityAt: Date.now(),
    });

    for (const cluster of CLUSTERS) {
      nodes.push({
        id: cluster.id,
        kind: "cluster",
        label: cluster.label,
        clusterId: null,
        weight: 0.6,
        lastActivityAt: null,
      });
      edges.push({ source: "core", target: cluster.id, strength: 1 });
    }

    // --- projects, and the conversations that belong to them ---------------
    const appRows = await db.query.apps.findMany({
      orderBy: [desc(apps.updatedAt)],
      limit: MAX_PER_CLUSTER,
    });

    const chatCounts = new Map<number, number>();
    for (const row of await db
      .select({ appId: chats.appId, count: sql<number>`count(*)` })
      .from(chats)
      .groupBy(chats.appId)) {
      chatCounts.set(row.appId, Number(row.count));
    }

    for (const app of appRows) {
      const id = `project-${app.id}`;
      // A project that has lost its working copy is a real problem worth
      // showing rather than hiding.
      const missing = !fs.existsSync(getDyadAppPath(app.path));
      nodes.push({
        id,
        kind: "project",
        label: app.name,
        clusterId: "cluster-projects",
        weight: weightFromCount(chatCounts.get(app.id) ?? 0),
        lastActivityAt: app.updatedAt?.getTime() ?? null,
        conflict: missing,
        route: "/apps",
        detail: {
          Type: "Project",
          Conversations: chatCounts.get(app.id) ?? 0,
          Path: app.path,
          ...(app.githubRepo ? { GitHub: app.githubRepo } : {}),
          ...(missing
            ? { Status: "Working copy missing on this machine" }
            : {}),
        },
      });
      edges.push({ source: "cluster-projects", target: id, strength: 0.8 });
    }

    // --- conversations ------------------------------------------------------
    const chatRows = await db.query.chats.findMany({
      orderBy: [desc(chats.createdAt)],
      limit: MAX_PER_CLUSTER,
    });

    const messageCounts = new Map<number, number>();
    for (const row of await db
      .select({ chatId: messages.chatId, count: sql<number>`count(*)` })
      .from(messages)
      .groupBy(messages.chatId)) {
      messageCounts.set(row.chatId, Number(row.count));
    }

    for (const chat of chatRows) {
      const id = `conversation-${chat.id}`;
      const count = messageCounts.get(chat.id) ?? 0;
      nodes.push({
        id,
        kind: "conversation",
        label: chat.title?.trim() || `Conversation ${chat.id}`,
        clusterId: "cluster-conversations",
        weight: weightFromCount(count, 40),
        lastActivityAt: chat.createdAt?.getTime() ?? null,
        route: `/chat?id=${chat.id}`,
        detail: { Type: "Conversation", Messages: count },
      });
      edges.push({
        source: "cluster-conversations",
        target: id,
        strength: 0.6,
      });
      // The real relationship: this conversation belongs to that project.
      if (appRows.some((app) => app.id === chat.appId)) {
        edges.push({
          source: `project-${chat.appId}`,
          target: id,
          // Longer conversations bind more strongly to their project.
          strength: 0.4 + weightFromCount(count, 40) * 0.5,
        });
      }
    }

    // --- agents -------------------------------------------------------------
    for (const agent of await db.query.agentOsAgents.findMany({
      orderBy: [desc(agentOsAgents.lastActivityAt)],
      limit: MAX_PER_CLUSTER,
    })) {
      const id = `agent-${agent.id}`;
      nodes.push({
        id,
        kind: "agent",
        label: agent.name,
        clusterId: "cluster-agents",
        weight: weightFromCount(agent.taskCount, 20),
        lastActivityAt: agent.lastActivityAt?.getTime() ?? null,
        conflict: agent.status === "error",
        verified: agent.status === "online",
        route: "/agent-os",
        detail: {
          Type: `${agent.type} agent`,
          Status: agent.status,
          Tasks: agent.taskCount,
          ...(agent.model ? { Model: agent.model } : {}),
        },
      });
      edges.push({ source: "cluster-agents", target: id, strength: 0.7 });
    }

    // --- documents in the vault --------------------------------------------
    const vaultPath = readSettings().storage?.localVaultPath?.trim();
    if (vaultPath) {
      const folder = vaultDocumentsPath(vaultPath);
      try {
        const entries = fs
          .readdirSync(folder, { withFileTypes: true })
          .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
          .slice(0, MAX_PER_CLUSTER);
        for (const entry of entries) {
          const full = path.join(folder, entry.name);
          const stat = fs.statSync(full);
          const id = `document-${entry.name}`;
          nodes.push({
            id,
            kind: "document",
            label: entry.name,
            clusterId: "cluster-documents",
            weight: weightFromCount(Math.round(stat.size / 4096), 60),
            lastActivityAt: stat.mtimeMs,
            route: "/knowledge-base",
            detail: {
              Type: "Document",
              Size: `${Math.max(1, Math.round(stat.size / 1024))} KB`,
            },
          });
          edges.push({
            source: "cluster-documents",
            target: id,
            strength: 0.5,
          });
        }
      } catch {
        // No documents folder yet — the cluster simply stays empty.
      }
    }

    // --- configured providers ----------------------------------------------
    const providerSettings = readSettings().providerSettings ?? {};
    for (const [providerId, provider] of Object.entries(providerSettings)) {
      if (!provider?.apiKey?.value) continue;
      const id = `provider-${providerId}`;
      nodes.push({
        id,
        kind: "provider",
        label: providerId,
        clusterId: "cluster-providers",
        weight: 0.5,
        lastActivityAt: null,
        verified: true,
        route: "/settings",
        detail: { Type: "Model provider", Status: "Key configured" },
      });
      edges.push({ source: "cluster-providers", target: id, strength: 0.6 });
    }

    logger.log(`Knowledge graph: ${nodes.length} nodes, ${edges.length} edges`);
    return { nodes, edges, generatedAt: Date.now() };
  });
}
