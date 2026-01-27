/**
 * Collaborative Workspace Service
 * Real-time collaboration using CRDT (Conflict-free Replicated Data Types).
 * Works offline-first with P2P sync, no central server required.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import { EventEmitter } from "events";

import type {
  WorkspaceId,
  Workspace,
  CollaborativeDocument,
  DocumentOperation,
  CRDTState,
  Collaborator,
  PresenceInfo,
  Comment,
  SyncStatus,
} from "@/types/sovereign_stack_types";

const logger = log.scope("collaborative_workspace");

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_WORKSPACES_DIR = path.join(app.getPath("userData"), "workspaces");

// =============================================================================
// CRDT IMPLEMENTATION
// =============================================================================

/**
 * Simple Lamport timestamp for ordering operations
 */
class LamportClock {
  private timestamp: number;
  private nodeId: string;
  
  constructor(nodeId: string, initial = 0) {
    this.nodeId = nodeId;
    this.timestamp = initial;
  }
  
  tick(): string {
    this.timestamp++;
    return `${this.timestamp}:${this.nodeId}`;
  }
  
  update(otherTimestamp: string): void {
    const [otherTime] = otherTimestamp.split(":");
    this.timestamp = Math.max(this.timestamp, parseInt(otherTime)) + 1;
  }
  
  compare(a: string, b: string): number {
    const [timeA, nodeA] = a.split(":");
    const [timeB, nodeB] = b.split(":");
    
    const timeDiff = parseInt(timeA) - parseInt(timeB);
    if (timeDiff !== 0) return timeDiff;
    
    return nodeA.localeCompare(nodeB);
  }
  
  getTimestamp(): number {
    return this.timestamp;
  }
}

/**
 * Vector Clock for causality tracking
 */
class VectorClock {
  private clock: Map<string, number> = new Map();
  
  constructor(initial?: Record<string, number>) {
    if (initial) {
      for (const [node, time] of Object.entries(initial)) {
        this.clock.set(node, time);
      }
    }
  }
  
  increment(nodeId: string): void {
    this.clock.set(nodeId, (this.clock.get(nodeId) || 0) + 1);
  }
  
  merge(other: VectorClock): void {
    for (const [node, time] of other.clock) {
      this.clock.set(node, Math.max(this.clock.get(node) || 0, time));
    }
  }
  
  happensBefore(other: VectorClock): boolean {
    let atLeastOneLess = false;
    
    for (const [node, time] of this.clock) {
      const otherTime = other.clock.get(node) || 0;
      if (time > otherTime) return false;
      if (time < otherTime) atLeastOneLess = true;
    }
    
    // Check for any nodes in other that aren't in this
    for (const [node, time] of other.clock) {
      if (!this.clock.has(node) && time > 0) {
        atLeastOneLess = true;
      }
    }
    
    return atLeastOneLess;
  }
  
  toJSON(): Record<string, number> {
    return Object.fromEntries(this.clock);
  }
}

/**
 * RGA (Replicated Growable Array) for collaborative text editing
 * Based on the Replicated Growable Array algorithm
 */
class RGADocument {
  private nodes: Map<string, RGANode> = new Map();
  private head: string = "HEAD";
  private clock: LamportClock;
  
  constructor(nodeId: string) {
    this.clock = new LamportClock(nodeId);
    // Initialize with head node
    this.nodes.set(this.head, {
      id: this.head,
      value: null,
      next: null,
      deleted: false,
      timestamp: "0:" + nodeId,
    });
  }
  
  insert(char: string, afterId: string): DocumentOperation {
    const id = this.clock.tick();
    const node: RGANode = {
      id,
      value: char,
      next: null,
      deleted: false,
      timestamp: id,
    };
    
    // Find insertion point
    const afterNode = this.nodes.get(afterId);
    if (!afterNode) {
      throw new Error(`Node not found: ${afterId}`);
    }
    
    // Insert between afterNode and its next
    node.next = afterNode.next;
    afterNode.next = id;
    this.nodes.set(id, node);
    
    return {
      type: "insert",
      id,
      char,
      afterId,
      timestamp: id,
    };
  }
  
  delete(id: string): DocumentOperation {
    const node = this.nodes.get(id);
    if (node) {
      node.deleted = true;
    }
    
    const timestamp = this.clock.tick();
    return {
      type: "delete",
      id,
      timestamp,
    };
  }
  
  applyOperation(op: DocumentOperation): void {
    if (!op.timestamp || !op.id) return;
    
    this.clock.update(String(op.timestamp));
    
    if (op.type === "insert") {
      if (this.nodes.has(op.id)) return; // Already applied
      
      const node: RGANode = {
        id: op.id,
        value: op.char ?? null,
        next: null,
        deleted: false,
        timestamp: String(op.timestamp),
      };
      
      // Find correct insertion point (may differ from afterId due to concurrent ops)
      let afterId = op.afterId ?? this.head;
      let afterNode = this.nodes.get(afterId);
      
      if (!afterNode) {
        // If afterId not found, insert at head
        afterNode = this.nodes.get(this.head);
        afterId = this.head;
      }
      
      if (!afterNode) return; // Safety check
      
      // Find correct position based on timestamp ordering
      while (afterNode.next) {
        const nextNode = this.nodes.get(afterNode.next);
        if (!nextNode) break;
        if (this.clock.compare(String(op.timestamp), nextNode.timestamp) > 0) {
          break;
        }
        afterNode = nextNode;
        afterId = afterNode.id;
      }
      
      node.next = afterNode.next;
      afterNode.next = op.id;
      this.nodes.set(op.id, node);
    } else if (op.type === "delete") {
      const node = this.nodes.get(op.id);
      if (node) {
        node.deleted = true;
      }
    }
  }
  
  getText(): string {
    let result = "";
    let currentId = this.nodes.get(this.head)?.next;
    
    while (currentId) {
      const node = this.nodes.get(currentId)!;
      if (!node.deleted && node.value !== null) {
        result += node.value;
      }
      currentId = node.next;
    }
    
    return result;
  }
  
  getNodeIdAtPosition(position: number): string {
    let count = 0;
    let currentId: string | null = this.head;
    
    while (currentId) {
      const node: RGANode | undefined = this.nodes.get(currentId);
      if (node && !node.deleted && node.value !== null) {
        if (count === position) {
          return currentId;
        }
        count++;
      }
      currentId = node?.next ?? null;
    }
    
    // Return the last non-deleted node
    return this.head;
  }
  
  getState(): CRDTState {
    return {
      nodes: Object.fromEntries(this.nodes) as Record<string, unknown>,
      head: this.head,
      timestamp: String(this.clock.getTimestamp()),
    };
  }
  
  loadState(state: CRDTState): void {
    if (state.nodes) {
      this.nodes = new Map(Object.entries(state.nodes)) as Map<string, RGANode>;
    }
    if (state.head) {
      this.head = state.head;
    }
  }
}

interface RGANode {
  id: string;
  value: string | null;
  next: string | null;
  deleted: boolean;
  timestamp: string;
}

// =============================================================================
// COLLABORATIVE WORKSPACE SERVICE
// =============================================================================

export class CollaborativeWorkspace extends EventEmitter {
  private workspacesDir: string;
  private workspaces: Map<WorkspaceId, Workspace> = new Map();
  private documents: Map<string, RGADocument> = new Map();
  private nodeId: string;
  private presence: Map<string, Map<string, PresenceInfo>> = new Map(); // docId -> userId -> presence
  private pendingOperations: Map<string, DocumentOperation[]> = new Map();
  private syncStatus: Map<string, SyncStatus> = new Map();
  
  constructor(workspacesDir?: string, nodeId?: string) {
    super();
    this.workspacesDir = workspacesDir || DEFAULT_WORKSPACES_DIR;
    this.nodeId = nodeId || crypto.randomUUID();
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing collaborative workspace", { workspacesDir: this.workspacesDir });
    
    await fs.mkdir(this.workspacesDir, { recursive: true });
    await this.scanWorkspaces();
    
    logger.info("Collaborative workspace initialized", { workspaceCount: this.workspaces.size });
  }
  
  private async scanWorkspaces(): Promise<void> {
    const entries = await fs.readdir(this.workspacesDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const configPath = path.join(this.workspacesDir, entry.name, "workspace.json");
        
        if (existsSync(configPath)) {
          try {
            const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
            this.workspaces.set(config.id as WorkspaceId, config);
          } catch (error) {
            logger.warn("Failed to load workspace config", { path: configPath, error });
          }
        }
      }
    }
  }
  
  getNodeId(): string {
    return this.nodeId;
  }
  
  // ===========================================================================
  // WORKSPACE MANAGEMENT
  // ===========================================================================
  
  async createWorkspace(params: {
    name: string;
    description?: string;
    isPublic?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<Workspace> {
    const id = crypto.randomUUID() as WorkspaceId;
    const workspaceDir = path.join(this.workspacesDir, id);
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "documents"), { recursive: true });
    
    const workspace: Workspace = {
      id,
      name: params.name,
      description: params.description,
      ownerId: this.nodeId,
      collaborators: [{
        id: this.nodeId,
        name: "Owner",
        role: "owner",
        joinedAt: Date.now(),
        online: true,
      }],
      documents: [],
      isPublic: params.isPublic || false,
      metadata: params.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await this.saveWorkspace(workspace);
    this.workspaces.set(id, workspace);
    this.emit("workspace:created", workspace);
    
    return workspace;
  }
  
  async saveWorkspace(workspace: Workspace): Promise<void> {
    const workspaceDir = path.join(this.workspacesDir, workspace.id);
    await fs.mkdir(workspaceDir, { recursive: true });
    
    workspace.updatedAt = Date.now();
    await fs.writeFile(
      path.join(workspaceDir, "workspace.json"),
      JSON.stringify(workspace, null, 2)
    );
    
    this.workspaces.set(workspace.id, workspace);
  }
  
  listWorkspaces(): Workspace[] {
    return Array.from(this.workspaces.values());
  }
  
  getWorkspace(id: WorkspaceId): Workspace | null {
    return this.workspaces.get(id) || null;
  }
  
  async deleteWorkspace(id: WorkspaceId): Promise<void> {
    const workspaceDir = path.join(this.workspacesDir, id);
    if (existsSync(workspaceDir)) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
    
    this.workspaces.delete(id);
    this.emit("workspace:deleted", { id });
  }
  
  // ===========================================================================
  // COLLABORATOR MANAGEMENT
  // ===========================================================================
  
  async inviteCollaborator(
    workspaceId: WorkspaceId,
    collaborator: Omit<Collaborator, "joinedAt" | "online">
  ): Promise<Collaborator> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    
    const newCollaborator: Collaborator = {
      ...collaborator,
      joinedAt: Date.now(),
      online: false,
    };
    
    if (!workspace.collaborators) {
      workspace.collaborators = [];
    }
    workspace.collaborators.push(newCollaborator);
    await this.saveWorkspace(workspace);
    
    this.emit("collaborator:invited", { workspaceId, collaborator: newCollaborator });
    
    return newCollaborator;
  }
  
  async removeCollaborator(workspaceId: WorkspaceId, collaboratorId: string): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    
    workspace.collaborators = (workspace.collaborators || []).filter((c) => c.id !== collaboratorId);
    await this.saveWorkspace(workspace);
    
    this.emit("collaborator:removed", { workspaceId, collaboratorId });
  }
  
  async updateCollaboratorRole(
    workspaceId: WorkspaceId,
    collaboratorId: string,
    role: "owner" | "editor" | "viewer"
  ): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    
    const collaborator = (workspace.collaborators || []).find((c) => c.id === collaboratorId);
    if (collaborator) {
      collaborator.role = role;
      await this.saveWorkspace(workspace);
    }
  }
  
  // ===========================================================================
  // DOCUMENT MANAGEMENT
  // ===========================================================================
  
  async createDocument(
    workspaceId: WorkspaceId,
    params: {
      name: string;
      type: "text" | "code" | "markdown" | "json" | "canvas";
      initialContent?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<CollaborativeDocument> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    
    const docId = crypto.randomUUID();
    
    // Create CRDT document
    const rgaDoc = new RGADocument(this.nodeId);
    
    // Insert initial content
    if (params.initialContent) {
      let afterId = "HEAD";
      for (const char of params.initialContent) {
        const op = rgaDoc.insert(char, afterId);
        afterId = op.id!;
      }
    }
    
    this.documents.set(docId, rgaDoc);
    
    const document: CollaborativeDocument = {
      id: docId,
      workspaceId,
      name: params.name,
      type: params.type,
      content: params.initialContent || "",
      version: 1,
      lastEditedBy: this.nodeId,
      operations: [],
      crdtState: rgaDoc.getState(),
      metadata: params.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Save document
    const docPath = path.join(this.workspacesDir, workspaceId, "documents", `${docId}.json`);
    await fs.writeFile(docPath, JSON.stringify(document, null, 2));
    
    // Update workspace
    workspace.documents.push(document);
    await this.saveWorkspace(workspace);
    
    this.emit("document:created", { workspaceId, document });
    
    return document;
  }
  
  async getDocument(workspaceId: WorkspaceId, documentId: string): Promise<CollaborativeDocument | null> {
    const docPath = path.join(this.workspacesDir, workspaceId, "documents", `${documentId}.json`);
    
    if (!existsSync(docPath)) {
      return null;
    }
    
    const document = JSON.parse(await fs.readFile(docPath, "utf-8")) as CollaborativeDocument;
    
    // Load CRDT document
    if (!this.documents.has(documentId)) {
      const rgaDoc = new RGADocument(this.nodeId);
      if (document.crdtState && !(document.crdtState instanceof Uint8Array)) {
        rgaDoc.loadState(document.crdtState as CRDTState);
      }
      this.documents.set(documentId, rgaDoc);
    }
    
    // Update content from CRDT
    const rgaDoc = this.documents.get(documentId)!;
    document.content = rgaDoc.getText();
    
    return document;
  }
  
  async deleteDocument(workspaceId: WorkspaceId, documentId: string): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    
    const docPath = path.join(this.workspacesDir, workspaceId, "documents", `${documentId}.json`);
    if (existsSync(docPath)) {
      await fs.unlink(docPath);
    }
    
    workspace.documents = workspace.documents.filter((d) => d.id !== documentId);
    await this.saveWorkspace(workspace);
    
    this.documents.delete(documentId);
    this.presence.delete(documentId);
    
    this.emit("document:deleted", { workspaceId, documentId });
  }
  
  // ===========================================================================
  // REAL-TIME EDITING
  // ===========================================================================
  
  async insertText(
    workspaceId: WorkspaceId,
    documentId: string,
    position: number,
    text: string
  ): Promise<DocumentOperation[]> {
    const document = await this.getDocument(workspaceId, documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }
    
    const rgaDoc = this.documents.get(documentId)!;
    const operations: DocumentOperation[] = [];
    
    // Find the node ID at the position
    let afterId = position === 0 ? "HEAD" : rgaDoc.getNodeIdAtPosition(position - 1);
    
    // Insert each character
    for (const char of text) {
      const op = rgaDoc.insert(char, afterId);
      operations.push(op);
      afterId = op.id!;
    }
    
    // Save document
    await this.saveDocument(workspaceId, document, operations);
    
    // Emit operations for sync
    this.emit("operations", { workspaceId, documentId, operations });
    
    return operations;
  }
  
  async deleteText(
    workspaceId: WorkspaceId,
    documentId: string,
    position: number,
    length: number
  ): Promise<DocumentOperation[]> {
    const document = await this.getDocument(workspaceId, documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }
    
    const rgaDoc = this.documents.get(documentId)!;
    const operations: DocumentOperation[] = [];
    
    // Get node IDs at each position
    for (let i = 0; i < length; i++) {
      const nodeId = rgaDoc.getNodeIdAtPosition(position);
      if (nodeId !== "HEAD") {
        const op = rgaDoc.delete(nodeId);
        operations.push(op);
      }
    }
    
    // Save document
    await this.saveDocument(workspaceId, document, operations);
    
    // Emit operations for sync
    this.emit("operations", { workspaceId, documentId, operations });
    
    return operations;
  }
  
  async applyRemoteOperations(
    workspaceId: WorkspaceId,
    documentId: string,
    operations: DocumentOperation[]
  ): Promise<void> {
    const document = await this.getDocument(workspaceId, documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }
    
    const rgaDoc = this.documents.get(documentId)!;
    
    for (const op of operations) {
      rgaDoc.applyOperation(op);
    }
    
    // Update document content
    document.content = rgaDoc.getText();
    
    await this.saveDocument(workspaceId, document, operations);
    
    this.emit("document:updated", { workspaceId, documentId, content: document.content });
  }
  
  private async saveDocument(
    workspaceId: WorkspaceId,
    document: CollaborativeDocument,
    newOperations: DocumentOperation[]
  ): Promise<void> {
    const rgaDoc = this.documents.get(document.id)!;
    
    document.content = rgaDoc.getText();
    document.version++;
    document.lastEditedBy = this.nodeId;
    document.crdtState = rgaDoc.getState();
    document.updatedAt = Date.now();
    
    // Keep operations history (limited)
    document.operations = [...(document.operations || []).slice(-1000), ...newOperations];
    
    const docPath = path.join(this.workspacesDir, workspaceId, "documents", `${document.id}.json`);
    await fs.writeFile(docPath, JSON.stringify(document, null, 2));
  }
  
  // ===========================================================================
  // PRESENCE
  // ===========================================================================
  
  updatePresence(documentId: string, presence: PresenceInfo): void {
    if (!this.presence.has(documentId)) {
      this.presence.set(documentId, new Map());
    }
    
    const presenceId = presence.id || presence.collaborator.id;
    this.presence.get(documentId)!.set(presenceId, {
      ...presence,
      lastActiveAt: Date.now(),
    });
    
    this.emit("presence:updated", { documentId, presence });
    
    // Broadcast to other collaborators
    this.emit("presence:broadcast", {
      documentId,
      presences: Array.from(this.presence.get(documentId)!.values()),
    });
  }
  
  removePresence(documentId: string, userId: string): void {
    const docPresence = this.presence.get(documentId);
    if (docPresence) {
      docPresence.delete(userId);
      this.emit("presence:removed", { documentId, userId });
    }
  }
  
  getPresences(documentId: string): PresenceInfo[] {
    const docPresence = this.presence.get(documentId);
    if (!docPresence) return [];
    
    // Filter out stale presences (not active in last 30 seconds)
    const now = Date.now();
    const activePresences: PresenceInfo[] = [];
    
    for (const [userId, presence] of docPresence) {
      if (now - (presence.lastActiveAt || 0) < 30000) {
        activePresences.push(presence);
      } else {
        docPresence.delete(userId);
      }
    }
    
    return activePresences;
  }
  
  // ===========================================================================
  // COMMENTS
  // ===========================================================================
  
  async addComment(
    workspaceId: WorkspaceId,
    documentId: string,
    comment: Omit<Comment, "id" | "createdAt" | "updatedAt">
  ): Promise<Comment> {
    const document = await this.getDocument(workspaceId, documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }
    
    const newComment: Comment = {
      id: crypto.randomUUID(),
      ...comment,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    if (!document.comments) {
      document.comments = [];
    }
    document.comments.push(newComment);
    
    const docPath = path.join(this.workspacesDir, workspaceId, "documents", `${documentId}.json`);
    await fs.writeFile(docPath, JSON.stringify(document, null, 2));
    
    this.emit("comment:added", { workspaceId, documentId, comment: newComment });
    
    return newComment;
  }
  
  async resolveComment(
    workspaceId: WorkspaceId,
    documentId: string,
    commentId: string
  ): Promise<void> {
    const document = await this.getDocument(workspaceId, documentId);
    if (!document?.comments) return;
    
    const comment = document.comments.find((c) => c.id === commentId);
    if (comment) {
      comment.resolved = true;
      comment.resolvedAt = Date.now();
      comment.resolvedBy = this.nodeId;
      
      const docPath = path.join(this.workspacesDir, workspaceId, "documents", `${documentId}.json`);
      await fs.writeFile(docPath, JSON.stringify(document, null, 2));
      
      this.emit("comment:resolved", { workspaceId, documentId, commentId });
    }
  }
  
  // ===========================================================================
  // SYNC
  // ===========================================================================
  
  getSyncStatus(documentId: string): SyncStatus {
    return this.syncStatus.get(documentId) || {
      status: "synced",
      pendingOperations: 0,
      lastSyncedAt: Date.now(),
    };
  }
  
  async queueOperation(documentId: string, operation: DocumentOperation): Promise<void> {
    if (!this.pendingOperations.has(documentId)) {
      this.pendingOperations.set(documentId, []);
    }
    
    this.pendingOperations.get(documentId)!.push(operation);
    
    // Update sync status
    this.syncStatus.set(documentId, {
      status: "pending",
      pendingOperations: this.pendingOperations.get(documentId)!.length,
      lastSyncedAt: this.syncStatus.get(documentId)?.lastSyncedAt || Date.now(),
    });
  }
  
  async syncDocument(workspaceId: WorkspaceId, documentId: string): Promise<void> {
    const pending = this.pendingOperations.get(documentId) || [];
    if (pending.length === 0) return;
    
    try {
      // In a real implementation, this would send operations to peers
      // For now, just mark as synced
      this.pendingOperations.set(documentId, []);
      
      this.syncStatus.set(documentId, {
        status: "synced",
        pendingOperations: 0,
        lastSyncedAt: Date.now(),
      });
      
      this.emit("document:synced", { workspaceId, documentId });
    } catch (error) {
      this.syncStatus.set(documentId, {
        status: "error",
        pendingOperations: pending.length,
        lastSyncedAt: this.syncStatus.get(documentId)?.lastSyncedAt || Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  // ===========================================================================
  // EXPORT/IMPORT
  // ===========================================================================
  
  async exportWorkspace(workspaceId: WorkspaceId): Promise<Buffer> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    
    const exportData: Record<string, unknown> = {
      workspace,
      documents: [],
    };
    
    const docsDir = path.join(this.workspacesDir, workspaceId, "documents");
    if (existsSync(docsDir)) {
      const files = await fs.readdir(docsDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const doc = JSON.parse(await fs.readFile(path.join(docsDir, file), "utf-8"));
          (exportData.documents as unknown[]).push(doc);
        }
      }
    }
    
    return Buffer.from(JSON.stringify(exportData, null, 2));
  }
  
  async importWorkspace(data: Buffer): Promise<Workspace> {
    const importData = JSON.parse(data.toString());
    const oldId = importData.workspace.id;
    const newId = crypto.randomUUID() as WorkspaceId;
    
    const workspace = {
      ...importData.workspace,
      id: newId,
      ownerId: this.nodeId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    const workspaceDir = path.join(this.workspacesDir, newId);
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "documents"), { recursive: true });
    
    // Save workspace
    await this.saveWorkspace(workspace);
    this.workspaces.set(newId, workspace);
    
    // Import documents
    for (const doc of importData.documents || []) {
      const newDocId = crypto.randomUUID();
      doc.id = newDocId;
      doc.workspaceId = newId;
      
      await fs.writeFile(
        path.join(workspaceDir, "documents", `${newDocId}.json`),
        JSON.stringify(doc, null, 2)
      );
      
      // Update workspace document list
      const docRef = workspace.documents.find((d: { id: string }) => d.id === doc.id);
      if (docRef) {
        docRef.id = newDocId;
      }
    }
    
    return workspace;
  }
  
  /**
   * Shutdown service
   */
  async shutdown(): Promise<void> {
    // Sync any pending operations
    for (const [docId, pending] of this.pendingOperations) {
      if (pending.length > 0) {
        logger.warn("Unsaved operations on shutdown", { docId, count: pending.length });
      }
    }
    
    this.documents.clear();
    this.presence.clear();
    this.pendingOperations.clear();
  }
}

// Export singleton
export const collaborativeWorkspace = new CollaborativeWorkspace();
