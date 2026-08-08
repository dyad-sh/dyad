import type { Request, Response } from "express";
import { db } from "./db";
import { logger } from "./logger";

interface AuthedRequest extends Request {
  userId?: string;
}

// ── Project handlers ───────────────────────────────────────────────────────

export async function getProject(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(`getProject called without userId from ${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(`getProject called with invalid id from user ${req.userId}`);
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const rows = await db.query("SELECT * FROM projects WHERE id = ?", [id]);
  if (rows.length === 0) {
    res.status(404).json({ error: "not found" });
    return;
  }
  logger.info(`getProject(${id}) took ${Date.now() - start}ms`);
  res.json(rows[0]);
}

export async function updateProject(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(`updateProject called without userId from ${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(`updateProject called with invalid id from user ${req.userId}`);
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const name = req.body.name as string;
  await db.query("UPDATE projects SET name = ? WHERE id = ?", [name, id]);
  logger.info(`updateProject(${id}) took ${Date.now() - start}ms`);
  res.json({ ok: true });
}

export async function deleteProject(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(`deleteProject called without userId from ${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(`deleteProject called with invalid id from user ${req.userId}`);
    res.status(400).json({ error: "invalid id" });
    return;
  }

  await db.query("DELETE FROM projects WHERE id = ?", [id]);
  logger.info(`deleteProject(${id}) took ${Date.now() - start}ms`);
  res.json({ ok: true });
}

export async function archiveProject(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(`archiveProject called without userId from ${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(
      `archiveProject called with invalid id from user ${req.userId}`,
    );
    res.status(400).json({ error: "invalid id" });
    return;
  }

  await db.query(
    "UPDATE projects SET status = 'archived', archived_at = ? WHERE id = ?",
    [new Date().toISOString(), id],
  );
  logger.info(`archiveProject(${id}) took ${Date.now() - start}ms`);
  res.json({ ok: true });
}

export async function getProjectMembers(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(`getProjectMembers called without userId from ${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(
      `getProjectMembers called with invalid id from user ${req.userId}`,
    );
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const rows = await db.query(
    "SELECT u.id, u.name, u.email, pm.role FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ?",
    [id],
  );
  logger.info(`getProjectMembers(${id}) took ${Date.now() - start}ms`);
  res.json({ members: rows });
}

export async function addProjectMember(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(`addProjectMember called without userId from ${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(
      `addProjectMember called with invalid id from user ${req.userId}`,
    );
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const { memberId, role } = req.body as { memberId: string; role: string };
  await db.query(
    "INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)",
    [id, memberId, role, new Date().toISOString()],
  );
  logger.info(
    `addProjectMember(${id}, member=${memberId}) took ${Date.now() - start}ms`,
  );
  res.status(201).json({ ok: true });
}

export async function removeProjectMember(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(`removeProjectMember called without userId from ${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(
      `removeProjectMember called with invalid id from user ${req.userId}`,
    );
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const { memberId } = req.params;
  await db.query(
    "DELETE FROM project_members WHERE project_id = ? AND user_id = ?",
    [id, memberId],
  );
  logger.info(
    `removeProjectMember(${id}, member=${memberId}) took ${Date.now() - start}ms`,
  );
  res.json({ ok: true });
}

export async function transferProjectOwnership(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(
      `transferProjectOwnership called without userId from ${req.ip}`,
    );
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(
      `transferProjectOwnership called with invalid id from user ${req.userId}`,
    );
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const { newOwnerId } = req.body as { newOwnerId: string };
  await db.query(
    "UPDATE projects SET owner_id = ?, updated_at = ? WHERE id = ?",
    [newOwnerId, new Date().toISOString(), id],
  );
  logger.info(
    `transferProjectOwnership(${id}, newOwner=${newOwnerId}) took ${Date.now() - start}ms`,
  );
  res.json({ ok: true });
}

export async function listProjectVersions(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(`listProjectVersions called without userId from ${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(
      `listProjectVersions called with invalid id from user ${req.userId}`,
    );
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const rows = await db.query(
    "SELECT id, version, created_at, created_by FROM project_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 50",
    [id],
  );
  logger.info(`listProjectVersions(${id}) took ${Date.now() - start}ms`);
  res.json({ versions: rows });
}

export async function restoreProjectVersion(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(`restoreProjectVersion called without userId from ${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(
      `restoreProjectVersion called with invalid id from user ${req.userId}`,
    );
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const { versionId } = req.body as { versionId: string };
  const versionRows = await db.query(
    "SELECT * FROM project_versions WHERE id = ? AND project_id = ?",
    [versionId, id],
  );
  if (versionRows.length === 0) {
    res.status(404).json({ error: "version not found" });
    return;
  }

  await db.query("UPDATE projects SET data = ?, updated_at = ? WHERE id = ?", [
    (versionRows[0] as { data: unknown }).data,
    new Date().toISOString(),
    id,
  ]);
  logger.info(
    `restoreProjectVersion(${id}, version=${versionId}) took ${Date.now() - start}ms`,
  );
  res.json({ ok: true });
}

export async function duplicateProject(
  req: AuthedRequest,
  res: Response,
): Promise<void> {
  const start = Date.now();
  if (!req.userId) {
    logger.warn(`duplicateProject called without userId from ${req.ip}`);
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const id = req.params.id;
  if (!id || typeof id !== "string") {
    logger.warn(
      `duplicateProject called with invalid id from user ${req.userId}`,
    );
    res.status(400).json({ error: "invalid id" });
    return;
  }

  const rows = await db.query("SELECT * FROM projects WHERE id = ?", [id]);
  if (rows.length === 0) {
    res.status(404).json({ error: "not found" });
    return;
  }

  const { name } = req.body as { name: string };
  const newRows = await db.query(
    "INSERT INTO projects (name, owner_id, status, data, created_at) SELECT ?, owner_id, 'active', data, ? FROM projects WHERE id = ? RETURNING id",
    [name, new Date().toISOString(), id],
  );
  logger.info(
    `duplicateProject(${id} → ${(newRows[0] as { id: string }).id}) took ${Date.now() - start}ms`,
  );
  res.status(201).json(newRows[0]);
}
