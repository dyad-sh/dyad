/**
 * Data Lineage Handlers
 * Complete provenance tracking and transformation graphs
 * 
 * Features:
 * - Full item lineage tracking
 * - Transformation graph visualization
 * - Impact analysis (upstream/downstream)
 * - Provenance queries
 * - Audit trails
 * - Lineage export for compliance
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, inArray, and, sql, desc, like } from "drizzle-orm";
import { datasetItems, studioDatasets, provenanceRecords } from "@/db/schema";

const logger = log.scope("data_lineage");

// ============================================================================
// Types
// ============================================================================

interface LineageNode {
  id: string;
  type: "item" | "dataset" | "source" | "transformation" | "external";
  entityId: string;
  entityType: string;
  label: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

interface LineageEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: "derived_from" | "transformed_to" | "copied_from" | "merged_from" | "split_to" | "external_source";
  transformationType?: string;
  parameters?: Record<string, any>;
  createdAt: Date;
}

interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
  rootNodes: string[];
  leafNodes: string[];
}

interface TransformationRecord {
  id: string;
  name: string;
  type: string;
  description?: string;
  inputItems: string[];
  outputItems: string[];
  parameters: Record<string, any>;
  executedAt: Date;
  executedBy?: string;
  duration?: number;
  status: "success" | "failed" | "partial";
  errorMessage?: string;
}

interface ProvenanceQuery {
  entityId?: string;
  entityType?: string;
  datasetId?: string;
  transformationType?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  depth?: number;
  direction?: "upstream" | "downstream" | "both";
}

interface ImpactAnalysis {
  affectedItems: string[];
  affectedDatasets: string[];
  impactLevel: "direct" | "indirect" | "transitive";
  transformationChain: TransformationRecord[];
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId?: string;
  details: Record<string, any>;
  timestamp: Date;
}

// ============================================================================
// Storage
// ============================================================================

const lineageNodes: Map<string, LineageNode> = new Map();
const lineageEdges: Map<string, LineageEdge> = new Map();
const transformations: Map<string, TransformationRecord> = new Map();
const auditLog: AuditEntry[] = [];

function getLineageStorageDir(): string {
  return path.join(app.getPath("userData"), "data-lineage");
}

async function initializeLineageStorage() {
  const storageDir = getLineageStorageDir();
  await fs.ensureDir(storageDir);
  
  // Load nodes
  const nodesPath = path.join(storageDir, "lineage-nodes.json");
  if (await fs.pathExists(nodesPath)) {
    const data = await fs.readJson(nodesPath);
    for (const n of data) {
      lineageNodes.set(n.id, { ...n, createdAt: new Date(n.createdAt) });
    }
  }
  
  // Load edges
  const edgesPath = path.join(storageDir, "lineage-edges.json");
  if (await fs.pathExists(edgesPath)) {
    const data = await fs.readJson(edgesPath);
    for (const e of data) {
      lineageEdges.set(e.id, { ...e, createdAt: new Date(e.createdAt) });
    }
  }
  
  // Load transformations
  const transformationsPath = path.join(storageDir, "transformations.json");
  if (await fs.pathExists(transformationsPath)) {
    const data = await fs.readJson(transformationsPath);
    for (const t of data) {
      transformations.set(t.id, { ...t, executedAt: new Date(t.executedAt) });
    }
  }
  
  // Load audit log (last 10000 entries)
  const auditPath = path.join(storageDir, "audit-log.json");
  if (await fs.pathExists(auditPath)) {
    const data = await fs.readJson(auditPath);
    auditLog.push(...data.slice(-10000).map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) })));
  }
  
  logger.info(`Loaded ${lineageNodes.size} nodes, ${lineageEdges.size} edges, ${transformations.size} transformations`);
}

async function saveLineageNodes() {
  const storageDir = getLineageStorageDir();
  await fs.writeJson(
    path.join(storageDir, "lineage-nodes.json"),
    Array.from(lineageNodes.values()),
    { spaces: 2 }
  );
}

async function saveLineageEdges() {
  const storageDir = getLineageStorageDir();
  await fs.writeJson(
    path.join(storageDir, "lineage-edges.json"),
    Array.from(lineageEdges.values()),
    { spaces: 2 }
  );
}

async function saveTransformations() {
  const storageDir = getLineageStorageDir();
  await fs.writeJson(
    path.join(storageDir, "transformations.json"),
    Array.from(transformations.values()),
    { spaces: 2 }
  );
}

async function saveAuditLog() {
  const storageDir = getLineageStorageDir();
  await fs.writeJson(
    path.join(storageDir, "audit-log.json"),
    auditLog.slice(-10000),
    { spaces: 2 }
  );
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerDataLineageHandlers() {
  logger.info("Registering Data Lineage handlers");

  app.whenReady().then(() => {
    initializeLineageStorage().catch(err => {
      logger.error("Failed to initialize lineage storage:", err);
    });
  });

  // ========== Lineage Node Management ==========

  /**
   * Register a lineage node
   */
  ipcMain.handle("lineage:register-node", async (_event, args: {
    entityId: string;
    entityType: string;
    type: LineageNode["type"];
    label: string;
    metadata?: Record<string, any>;
  }) => {
    try {
      // Check if node already exists
      const existingNode = Array.from(lineageNodes.values()).find(
        n => n.entityId === args.entityId && n.entityType === args.entityType
      );
      
      if (existingNode) {
        return { success: true, node: existingNode, existing: true };
      }
      
      const id = uuidv4();
      const node: LineageNode = {
        id,
        type: args.type,
        entityId: args.entityId,
        entityType: args.entityType,
        label: args.label,
        metadata: args.metadata,
        createdAt: new Date(),
      };
      
      lineageNodes.set(id, node);
      await saveLineageNodes();
      
      // Audit
      addAuditEntry("register_node", "lineage_node", id, undefined, { node });
      
      return { success: true, node, existing: false };
    } catch (error) {
      logger.error("Register node failed:", error);
      throw error;
    }
  });

  /**
   * Create a lineage edge
   */
  ipcMain.handle("lineage:create-edge", async (_event, args: {
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: LineageEdge["edgeType"];
    transformationType?: string;
    parameters?: Record<string, any>;
  }) => {
    try {
      // Verify nodes exist
      if (!lineageNodes.has(args.sourceNodeId) || !lineageNodes.has(args.targetNodeId)) {
        throw new Error("Source or target node not found");
      }
      
      const id = uuidv4();
      const edge: LineageEdge = {
        id,
        sourceNodeId: args.sourceNodeId,
        targetNodeId: args.targetNodeId,
        edgeType: args.edgeType,
        transformationType: args.transformationType,
        parameters: args.parameters,
        createdAt: new Date(),
      };
      
      lineageEdges.set(id, edge);
      await saveLineageEdges();
      
      return { success: true, edge };
    } catch (error) {
      logger.error("Create edge failed:", error);
      throw error;
    }
  });

  /**
   * Record a transformation
   */
  ipcMain.handle("lineage:record-transformation", async (_event, args: {
    name: string;
    type: string;
    description?: string;
    inputItems: string[];
    outputItems: string[];
    parameters: Record<string, any>;
    executedBy?: string;
    duration?: number;
    status?: TransformationRecord["status"];
    errorMessage?: string;
  }) => {
    try {
      const id = uuidv4();
      const transformation: TransformationRecord = {
        id,
        name: args.name,
        type: args.type,
        description: args.description,
        inputItems: args.inputItems,
        outputItems: args.outputItems,
        parameters: args.parameters,
        executedAt: new Date(),
        executedBy: args.executedBy,
        duration: args.duration,
        status: args.status || "success",
        errorMessage: args.errorMessage,
      };
      
      transformations.set(id, transformation);
      
      // Create lineage connections
      for (const inputId of args.inputItems) {
        // Find or create input node
        let inputNode = Array.from(lineageNodes.values()).find(
          n => n.entityId === inputId && n.entityType === "item"
        );
        
        if (!inputNode) {
          inputNode = {
            id: uuidv4(),
            type: "item",
            entityId: inputId,
            entityType: "item",
            label: `Item ${inputId.substring(0, 8)}`,
            createdAt: new Date(),
          };
          lineageNodes.set(inputNode.id, inputNode);
        }
        
        // Create transformation node if not exists
        let transformNode = Array.from(lineageNodes.values()).find(
          n => n.entityId === id && n.entityType === "transformation"
        );
        
        if (!transformNode) {
          transformNode = {
            id: uuidv4(),
            type: "transformation",
            entityId: id,
            entityType: "transformation",
            label: args.name,
            metadata: { type: args.type, parameters: args.parameters },
            createdAt: new Date(),
          };
          lineageNodes.set(transformNode.id, transformNode);
        }
        
        // Edge: input -> transformation
        const inputEdge: LineageEdge = {
          id: uuidv4(),
          sourceNodeId: inputNode.id,
          targetNodeId: transformNode.id,
          edgeType: "transformed_to",
          transformationType: args.type,
          createdAt: new Date(),
        };
        lineageEdges.set(inputEdge.id, inputEdge);
        
        // Create output edges
        for (const outputId of args.outputItems) {
          let outputNode = Array.from(lineageNodes.values()).find(
            n => n.entityId === outputId && n.entityType === "item"
          );
          
          if (!outputNode) {
            outputNode = {
              id: uuidv4(),
              type: "item",
              entityId: outputId,
              entityType: "item",
              label: `Item ${outputId.substring(0, 8)}`,
              createdAt: new Date(),
            };
            lineageNodes.set(outputNode.id, outputNode);
          }
          
          // Edge: transformation -> output
          const outputEdge: LineageEdge = {
            id: uuidv4(),
            sourceNodeId: transformNode.id,
            targetNodeId: outputNode.id,
            edgeType: "derived_from",
            transformationType: args.type,
            createdAt: new Date(),
          };
          lineageEdges.set(outputEdge.id, outputEdge);
        }
      }
      
      await Promise.all([saveTransformations(), saveLineageNodes(), saveLineageEdges()]);
      
      // Audit
      addAuditEntry("record_transformation", "transformation", id, args.executedBy, { transformation });
      
      return { success: true, transformation };
    } catch (error) {
      logger.error("Record transformation failed:", error);
      throw error;
    }
  });

  // ========== Lineage Queries ==========

  /**
   * Get lineage for an item
   */
  ipcMain.handle("lineage:get-item-lineage", async (_event, args: {
    itemId: string;
    depth?: number;
    direction?: "upstream" | "downstream" | "both";
  }) => {
    try {
      const depth = args.depth || 10;
      const direction = args.direction || "both";
      
      // Find the node for this item
      const startNode = Array.from(lineageNodes.values()).find(
        n => n.entityId === args.itemId && n.entityType === "item"
      );
      
      if (!startNode) {
        return { success: true, graph: { nodes: [], edges: [], rootNodes: [], leafNodes: [] } };
      }
      
      const visitedNodes = new Set<string>();
      const resultNodes: LineageNode[] = [];
      const resultEdges: LineageEdge[] = [];
      
      // BFS traversal
      const queue: Array<{ nodeId: string; currentDepth: number; dir: "up" | "down" }> = [];
      
      if (direction === "upstream" || direction === "both") {
        queue.push({ nodeId: startNode.id, currentDepth: 0, dir: "up" });
      }
      if (direction === "downstream" || direction === "both") {
        queue.push({ nodeId: startNode.id, currentDepth: 0, dir: "down" });
      }
      
      while (queue.length > 0) {
        const { nodeId, currentDepth, dir } = queue.shift()!;
        
        if (visitedNodes.has(`${nodeId}-${dir}`)) continue;
        if (currentDepth > depth) continue;
        
        visitedNodes.add(`${nodeId}-${dir}`);
        
        const node = lineageNodes.get(nodeId);
        if (node && !resultNodes.find(n => n.id === nodeId)) {
          resultNodes.push(node);
        }
        
        // Find connected edges
        for (const edge of lineageEdges.values()) {
          if (dir === "up" && edge.targetNodeId === nodeId) {
            if (!resultEdges.find(e => e.id === edge.id)) {
              resultEdges.push(edge);
            }
            queue.push({ nodeId: edge.sourceNodeId, currentDepth: currentDepth + 1, dir });
          } else if (dir === "down" && edge.sourceNodeId === nodeId) {
            if (!resultEdges.find(e => e.id === edge.id)) {
              resultEdges.push(edge);
            }
            queue.push({ nodeId: edge.targetNodeId, currentDepth: currentDepth + 1, dir });
          }
        }
      }
      
      // Identify root and leaf nodes
      const nodesWithIncoming = new Set(resultEdges.map(e => e.targetNodeId));
      const nodesWithOutgoing = new Set(resultEdges.map(e => e.sourceNodeId));
      
      const rootNodes = resultNodes
        .filter(n => !nodesWithIncoming.has(n.id))
        .map(n => n.id);
      
      const leafNodes = resultNodes
        .filter(n => !nodesWithOutgoing.has(n.id))
        .map(n => n.id);
      
      const graph: LineageGraph = {
        nodes: resultNodes,
        edges: resultEdges,
        rootNodes,
        leafNodes,
      };
      
      return { success: true, graph };
    } catch (error) {
      logger.error("Get item lineage failed:", error);
      throw error;
    }
  });

  /**
   * Get dataset-level lineage
   */
  ipcMain.handle("lineage:get-dataset-lineage", async (_event, datasetId: string) => {
    try {
      // Get all items in dataset
      const items = await db.select({ id: datasetItems.id })
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
      
      const itemIds = new Set(items.map(i => i.id));
      
      // Find all nodes related to these items
      const relatedNodes = Array.from(lineageNodes.values()).filter(
        n => (n.entityType === "item" && itemIds.has(n.entityId)) ||
             (n.entityType === "dataset" && n.entityId === datasetId)
      );
      
      const nodeIds = new Set(relatedNodes.map(n => n.id));
      
      // Find edges connected to these nodes (including transformation nodes)
      const relatedEdges: LineageEdge[] = [];
      const additionalNodeIds = new Set<string>();
      
      for (const edge of lineageEdges.values()) {
        if (nodeIds.has(edge.sourceNodeId) || nodeIds.has(edge.targetNodeId)) {
          relatedEdges.push(edge);
          additionalNodeIds.add(edge.sourceNodeId);
          additionalNodeIds.add(edge.targetNodeId);
        }
      }
      
      // Add transformation nodes
      for (const nodeId of additionalNodeIds) {
        if (!nodeIds.has(nodeId)) {
          const node = lineageNodes.get(nodeId);
          if (node) {
            relatedNodes.push(node);
          }
        }
      }
      
      // Get transformation statistics
      const datasetTransformations = Array.from(transformations.values()).filter(
        t => t.inputItems.some(id => itemIds.has(id)) || t.outputItems.some(id => itemIds.has(id))
      );
      
      const transformationStats = {
        total: datasetTransformations.length,
        byType: {} as Record<string, number>,
        successRate: 0,
      };
      
      for (const t of datasetTransformations) {
        transformationStats.byType[t.type] = (transformationStats.byType[t.type] || 0) + 1;
      }
      
      const successful = datasetTransformations.filter(t => t.status === "success").length;
      transformationStats.successRate = datasetTransformations.length > 0 
        ? successful / datasetTransformations.length 
        : 1;
      
      return {
        success: true,
        graph: {
          nodes: relatedNodes,
          edges: relatedEdges,
          rootNodes: [],
          leafNodes: [],
        },
        transformations: datasetTransformations,
        stats: transformationStats,
      };
    } catch (error) {
      logger.error("Get dataset lineage failed:", error);
      throw error;
    }
  });

  /**
   * Perform provenance query
   */
  ipcMain.handle("lineage:query", async (_event, query: ProvenanceQuery) => {
    try {
      let nodes = Array.from(lineageNodes.values());
      let edges = Array.from(lineageEdges.values());
      let results = Array.from(transformations.values());
      
      // Filter by entity
      if (query.entityId) {
        const targetNode = nodes.find(n => n.entityId === query.entityId);
        if (targetNode) {
          // Get connected graph
          const connectedNodeIds = new Set<string>([targetNode.id]);
          const connectedEdgeIds = new Set<string>();
          
          let changed = true;
          while (changed) {
            changed = false;
            for (const edge of edges) {
              if (connectedNodeIds.has(edge.sourceNodeId) || connectedNodeIds.has(edge.targetNodeId)) {
                if (!connectedEdgeIds.has(edge.id)) {
                  connectedEdgeIds.add(edge.id);
                  connectedNodeIds.add(edge.sourceNodeId);
                  connectedNodeIds.add(edge.targetNodeId);
                  changed = true;
                }
              }
            }
          }
          
          nodes = nodes.filter(n => connectedNodeIds.has(n.id));
          edges = edges.filter(e => connectedEdgeIds.has(e.id));
        }
      }
      
      // Filter by entity type
      if (query.entityType) {
        nodes = nodes.filter(n => n.entityType === query.entityType);
      }
      
      // Filter by transformation type
      if (query.transformationType) {
        edges = edges.filter(e => e.transformationType === query.transformationType);
        results = results.filter(t => t.type === query.transformationType);
      }
      
      // Filter by date range
      if (query.dateRange) {
        const start = new Date(query.dateRange.start);
        const end = new Date(query.dateRange.end);
        
        nodes = nodes.filter(n => n.createdAt >= start && n.createdAt <= end);
        edges = edges.filter(e => e.createdAt >= start && e.createdAt <= end);
        results = results.filter(t => t.executedAt >= start && t.executedAt <= end);
      }
      
      return {
        success: true,
        nodes,
        edges,
        transformations: results,
      };
    } catch (error) {
      logger.error("Provenance query failed:", error);
      throw error;
    }
  });

  // ========== Impact Analysis ==========

  /**
   * Analyze downstream impact of an item
   */
  ipcMain.handle("lineage:impact-analysis", async (_event, args: {
    itemId: string;
    includeTransitive?: boolean;
  }) => {
    try {
      const includeTransitive = args.includeTransitive ?? true;
      
      // Find the starting node
      const startNode = Array.from(lineageNodes.values()).find(
        n => n.entityId === args.itemId && n.entityType === "item"
      );
      
      if (!startNode) {
        return {
          success: true,
          impact: {
            affectedItems: [],
            affectedDatasets: [],
            impactLevel: "direct" as const,
            transformationChain: [],
          },
        };
      }
      
      const directlyAffected = new Set<string>();
      const transitivelyAffected = new Set<string>();
      const affectedDatasets = new Set<string>();
      const transformationChain: TransformationRecord[] = [];
      
      // BFS to find downstream items
      const visited = new Set<string>();
      const queue: Array<{ nodeId: string; level: number }> = [{ nodeId: startNode.id, level: 0 }];
      
      while (queue.length > 0) {
        const { nodeId, level } = queue.shift()!;
        
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        
        const node = lineageNodes.get(nodeId);
        if (!node) continue;
        
        // Find outgoing edges
        for (const edge of lineageEdges.values()) {
          if (edge.sourceNodeId === nodeId) {
            const targetNode = lineageNodes.get(edge.targetNodeId);
            if (!targetNode) continue;
            
            if (targetNode.type === "item") {
              if (level === 0) {
                directlyAffected.add(targetNode.entityId);
              } else {
                transitivelyAffected.add(targetNode.entityId);
              }
              
              // Find dataset for this item
              const item = await db.select().from(datasetItems).where(eq(datasetItems.id, targetNode.entityId));
              if (item.length > 0) {
                affectedDatasets.add(item[0].datasetId);
              }
            }
            
            if (targetNode.type === "transformation") {
              const trans = transformations.get(targetNode.entityId);
              if (trans && !transformationChain.find(t => t.id === trans.id)) {
                transformationChain.push(trans);
              }
            }
            
            if (includeTransitive || level === 0) {
              queue.push({ nodeId: edge.targetNodeId, level: level + 1 });
            }
          }
        }
      }
      
      const impact: ImpactAnalysis = {
        affectedItems: [...directlyAffected, ...transitivelyAffected],
        affectedDatasets: Array.from(affectedDatasets),
        impactLevel: transitivelyAffected.size > 0 ? "transitive" : (directlyAffected.size > 0 ? "direct" : "direct"),
        transformationChain,
      };
      
      return { success: true, impact };
    } catch (error) {
      logger.error("Impact analysis failed:", error);
      throw error;
    }
  });

  /**
   * Find common ancestors of items
   */
  ipcMain.handle("lineage:find-common-ancestors", async (_event, itemIds: string[]) => {
    try {
      if (itemIds.length < 2) {
        return { success: true, ancestors: [] };
      }
      
      // Get ancestors for each item
      const ancestorSets: Set<string>[] = [];
      
      for (const itemId of itemIds) {
        const ancestors = new Set<string>();
        const startNode = Array.from(lineageNodes.values()).find(
          n => n.entityId === itemId && n.entityType === "item"
        );
        
        if (startNode) {
          const visited = new Set<string>();
          const queue = [startNode.id];
          
          while (queue.length > 0) {
            const nodeId = queue.shift()!;
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);
            
            const node = lineageNodes.get(nodeId);
            if (node && node.type === "item") {
              ancestors.add(node.entityId);
            }
            
            // Find incoming edges (upstream)
            for (const edge of lineageEdges.values()) {
              if (edge.targetNodeId === nodeId) {
                queue.push(edge.sourceNodeId);
              }
            }
          }
        }
        
        ancestorSets.push(ancestors);
      }
      
      // Find intersection
      let commonAncestors = ancestorSets[0];
      for (let i = 1; i < ancestorSets.length; i++) {
        commonAncestors = new Set([...commonAncestors].filter(x => ancestorSets[i].has(x)));
      }
      
      // Remove the input items themselves
      for (const id of itemIds) {
        commonAncestors.delete(id);
      }
      
      return { success: true, ancestors: Array.from(commonAncestors) };
    } catch (error) {
      logger.error("Find common ancestors failed:", error);
      throw error;
    }
  });

  // ========== Audit Trail ==========

  /**
   * Get audit trail
   */
  ipcMain.handle("lineage:get-audit-trail", async (_event, args?: {
    entityType?: string;
    entityId?: string;
    action?: string;
    userId?: string;
    limit?: number;
    offset?: number;
    dateRange?: { start: string; end: string };
  }) => {
    try {
      let results = [...auditLog];
      
      if (args?.entityType) {
        results = results.filter(e => e.entityType === args.entityType);
      }
      
      if (args?.entityId) {
        results = results.filter(e => e.entityId === args.entityId);
      }
      
      if (args?.action) {
        results = results.filter(e => e.action === args.action);
      }
      
      if (args?.userId) {
        results = results.filter(e => e.userId === args.userId);
      }
      
      if (args?.dateRange) {
        const start = new Date(args.dateRange.start);
        const end = new Date(args.dateRange.end);
        results = results.filter(e => e.timestamp >= start && e.timestamp <= end);
      }
      
      // Sort by timestamp descending
      results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      const total = results.length;
      
      if (args?.offset) {
        results = results.slice(args.offset);
      }
      
      if (args?.limit) {
        results = results.slice(0, args.limit);
      }
      
      return { success: true, entries: results, total };
    } catch (error) {
      logger.error("Get audit trail failed:", error);
      throw error;
    }
  });

  // ========== Export ==========

  /**
   * Export lineage for compliance
   */
  ipcMain.handle("lineage:export", async (_event, args: {
    datasetId?: string;
    format: "json" | "graphml" | "dot";
    outputPath: string;
    includeAudit?: boolean;
  }) => {
    try {
      let nodesToExport = Array.from(lineageNodes.values());
      let edgesToExport = Array.from(lineageEdges.values());
      let transformationsToExport = Array.from(transformations.values());
      
      if (args.datasetId) {
        // Get items in dataset
        const items = await db.select({ id: datasetItems.id })
          .from(datasetItems)
          .where(eq(datasetItems.datasetId, args.datasetId));
        
        const itemIds = new Set(items.map(i => i.id));
        
        nodesToExport = nodesToExport.filter(n => 
          (n.entityType === "item" && itemIds.has(n.entityId)) ||
          n.entityType === "transformation"
        );
        
        const nodeIds = new Set(nodesToExport.map(n => n.id));
        edgesToExport = edgesToExport.filter(e => 
          nodeIds.has(e.sourceNodeId) || nodeIds.has(e.targetNodeId)
        );
        
        transformationsToExport = transformationsToExport.filter(t =>
          t.inputItems.some(id => itemIds.has(id)) || t.outputItems.some(id => itemIds.has(id))
        );
      }
      
      await fs.ensureDir(path.dirname(args.outputPath));
      
      if (args.format === "json") {
        const exportData: any = {
          exportedAt: new Date().toISOString(),
          datasetId: args.datasetId || "all",
          lineage: {
            nodes: nodesToExport,
            edges: edgesToExport,
          },
          transformations: transformationsToExport,
        };
        
        if (args.includeAudit) {
          exportData.auditTrail = args.datasetId
            ? auditLog.filter(e => e.details?.datasetId === args.datasetId)
            : auditLog;
        }
        
        await fs.writeJson(args.outputPath, exportData, { spaces: 2 });
      } else if (args.format === "graphml") {
        // GraphML export for visualization tools
        let graphml = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="label" for="node" attr.name="label" attr.type="string"/>
  <key id="type" for="node" attr.name="type" attr.type="string"/>
  <key id="edgeType" for="edge" attr.name="edgeType" attr.type="string"/>
  <graph id="lineage" edgedefault="directed">
`;
        
        for (const node of nodesToExport) {
          graphml += `    <node id="${node.id}">
      <data key="label">${escapeXml(node.label)}</data>
      <data key="type">${node.type}</data>
    </node>
`;
        }
        
        for (const edge of edgesToExport) {
          graphml += `    <edge source="${edge.sourceNodeId}" target="${edge.targetNodeId}">
      <data key="edgeType">${edge.edgeType}</data>
    </edge>
`;
        }
        
        graphml += `  </graph>
</graphml>`;
        
        await fs.writeFile(args.outputPath, graphml);
      } else if (args.format === "dot") {
        // DOT format for Graphviz
        let dot = `digraph lineage {
  rankdir=LR;
  node [shape=box];
`;
        
        for (const node of nodesToExport) {
          const shape = node.type === "transformation" ? "ellipse" : "box";
          const color = node.type === "item" ? "lightblue" : (node.type === "transformation" ? "lightyellow" : "lightgray");
          dot += `  "${node.id}" [label="${escapeDot(node.label)}" shape=${shape} fillcolor="${color}" style=filled];\n`;
        }
        
        for (const edge of edgesToExport) {
          const style = edge.edgeType === "merged_from" ? "dashed" : "solid";
          dot += `  "${edge.sourceNodeId}" -> "${edge.targetNodeId}" [style=${style}];\n`;
        }
        
        dot += `}\n`;
        
        await fs.writeFile(args.outputPath, dot);
      }
      
      return {
        success: true,
        exported: {
          nodes: nodesToExport.length,
          edges: edgesToExport.length,
          transformations: transformationsToExport.length,
        },
        outputPath: args.outputPath,
      };
    } catch (error) {
      logger.error("Export lineage failed:", error);
      throw error;
    }
  });

  /**
   * Clear lineage data (for testing/cleanup)
   */
  ipcMain.handle("lineage:clear", async (_event, args?: {
    datasetId?: string;
    olderThan?: string;
  }) => {
    try {
      if (args?.datasetId) {
        // Get items in dataset
        const items = await db.select({ id: datasetItems.id })
          .from(datasetItems)
          .where(eq(datasetItems.datasetId, args.datasetId));
        
        const itemIds = new Set(items.map(i => i.id));
        
        // Remove nodes for these items
        for (const [nodeId, node] of lineageNodes) {
          if (node.entityType === "item" && itemIds.has(node.entityId)) {
            lineageNodes.delete(nodeId);
          }
        }
        
        // Remove orphaned edges
        const nodeIds = new Set(lineageNodes.keys());
        for (const [edgeId, edge] of lineageEdges) {
          if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) {
            lineageEdges.delete(edgeId);
          }
        }
      } else if (args?.olderThan) {
        const cutoff = new Date(args.olderThan);
        
        for (const [nodeId, node] of lineageNodes) {
          if (node.createdAt < cutoff) {
            lineageNodes.delete(nodeId);
          }
        }
        
        for (const [edgeId, edge] of lineageEdges) {
          if (edge.createdAt < cutoff) {
            lineageEdges.delete(edgeId);
          }
        }
        
        for (const [transId, trans] of transformations) {
          if (trans.executedAt < cutoff) {
            transformations.delete(transId);
          }
        }
      } else {
        // Clear all
        lineageNodes.clear();
        lineageEdges.clear();
        transformations.clear();
      }
      
      await Promise.all([saveLineageNodes(), saveLineageEdges(), saveTransformations()]);
      
      return { success: true };
    } catch (error) {
      logger.error("Clear lineage failed:", error);
      throw error;
    }
  });

  logger.info("Data Lineage handlers registered");
}

// ============================================================================
// Helper Functions
// ============================================================================

function addAuditEntry(
  action: string,
  entityType: string,
  entityId: string,
  userId?: string,
  details?: Record<string, any>
) {
  const entry: AuditEntry = {
    id: uuidv4(),
    action,
    entityType,
    entityId,
    userId,
    details: details || {},
    timestamp: new Date(),
  };
  
  auditLog.push(entry);
  
  // Async save (don't await)
  saveAuditLog().catch(() => {});
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeDot(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
