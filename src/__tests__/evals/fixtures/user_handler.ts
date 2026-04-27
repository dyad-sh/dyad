import type { Request, Response } from "express";
import { db } from "./db";
import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────────────

type UserRole = "admin" | "member" | "guest";

interface User {
  id: string;
  email: string;
  name: string;
  age: number;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  bio: string | null;
  avatarUrl: string | null;
  isActive: boolean;
}

interface UpdateUserBody {
  name?: string;
  age?: number;
  role?: UserRole;
  bio?: string;
  avatarUrl?: string;
  isActive?: boolean;
}

interface ListUsersQuery {
  role?: UserRole;
  isActive?: string;
  page?: string;
  limit?: string;
  search?: string;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseIntParam(value: string | undefined, defaultVal: number): number {
  if (!value) return defaultVal;
  const n = parseInt(value, 10);
  return isNaN(n) ? defaultVal : n;
}

function buildWhereClause(query: ListUsersQuery): {
  sql: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.role) {
    conditions.push("role = ?");
    params.push(query.role);
  }
  if (query.isActive !== undefined) {
    conditions.push("is_active = ?");
    params.push(query.isActive === "true" ? 1 : 0);
  }
  if (query.search) {
    conditions.push("(name LIKE ? OR email LIKE ?)");
    const pattern = `%${query.search}%`;
    params.push(pattern, pattern);
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

// ── Handlers ───────────────────────────────────────────────────────────────

export async function createUserHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const email = req.body.email as string;
  const name = req.body.name as string;
  const age = req.body.age as number;
  const role = req.body.role as "admin" | "member" | "guest";

  const existing = await db.query("SELECT id FROM users WHERE email = ?", [
    email,
  ]);
  if (existing.length > 0) {
    res.status(409).json({ error: "email already in use" });
    return;
  }

  const rows = await db.query(
    "INSERT INTO users (email, name, age, role) VALUES (?, ?, ?, ?) RETURNING *",
    [email, name, age, role],
  );

  logger.info(`created user ${rows[0].id} with role ${role}`);
  res.status(201).json(rows[0]);
}

export async function getUserHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "missing id" });
    return;
  }

  const rows = await db.query("SELECT * FROM users WHERE id = ?", [id]);
  if (rows.length === 0) {
    res.status(404).json({ error: "user not found" });
    return;
  }

  logger.info(`fetched user ${id}`);
  res.json(rows[0]);
}

export async function listUsersHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.query as ListUsersQuery;
  const page = parseIntParam(query.page, 1);
  const limit = parseIntParam(query.limit, 20);
  const offset = (page - 1) * limit;

  const { sql: whereClause, params: whereParams } = buildWhereClause(query);

  const countRows = await db.query(
    `SELECT COUNT(*) AS total FROM users ${whereClause}`,
    whereParams,
  );
  const total = (countRows[0] as { total: number }).total;

  const rows = await db.query(
    `SELECT * FROM users ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...whereParams, limit, offset],
  );

  const response: PaginatedResponse<User> = {
    items: rows as User[],
    total,
    page,
    limit,
    hasMore: offset + rows.length < total,
  };

  logger.info(`listed ${rows.length} users (page=${page}, total=${total})`);
  res.json(response);
}

export async function updateUserHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "missing id" });
    return;
  }

  const existing = await db.query("SELECT * FROM users WHERE id = ?", [id]);
  if (existing.length === 0) {
    res.status(404).json({ error: "user not found" });
    return;
  }

  const body = req.body as UpdateUserBody;

  if (body.role && !["admin", "member", "guest"].includes(body.role)) {
    res.status(400).json({ error: "invalid role" });
    return;
  }

  if (
    body.age !== undefined &&
    (typeof body.age !== "number" || body.age < 0)
  ) {
    res.status(400).json({ error: "age must be a non-negative number" });
    return;
  }

  if (body.name !== undefined && body.name.trim().length === 0) {
    res.status(400).json({ error: "name cannot be empty" });
    return;
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(body)) {
    setClauses.push(`${key} = ?`);
    params.push(value);
  }
  setClauses.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  const rows = await db.query(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = ? RETURNING *`,
    params,
  );

  logger.info(`updated user ${id}`);
  res.json(rows[0]);
}

export async function deleteUserHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "missing id" });
    return;
  }

  const existing = await db.query("SELECT id FROM users WHERE id = ?", [id]);
  if (existing.length === 0) {
    res.status(404).json({ error: "user not found" });
    return;
  }

  await db.query("DELETE FROM users WHERE id = ?", [id]);
  logger.info(`deleted user ${id}`);
  res.status(204).send();
}

export async function changeRoleHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params;
  const { role } = req.body as { role: UserRole };

  if (!["admin", "member", "guest"].includes(role)) {
    res.status(400).json({ error: "invalid role" });
    return;
  }

  const existing = await db.query("SELECT id, role FROM users WHERE id = ?", [
    id,
  ]);
  if (existing.length === 0) {
    res.status(404).json({ error: "user not found" });
    return;
  }

  const previousRole = (existing[0] as { role: string }).role;
  await db.query("UPDATE users SET role = ?, updated_at = ? WHERE id = ?", [
    role,
    new Date().toISOString(),
    id,
  ]);

  logger.info(`changed role for user ${id}: ${previousRole} → ${role}`);
  res.json({ id, role });
}

export async function deactivateUserHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params;

  const existing = await db.query(
    "SELECT id, is_active FROM users WHERE id = ?",
    [id],
  );
  if (existing.length === 0) {
    res.status(404).json({ error: "user not found" });
    return;
  }

  if (!(existing[0] as { is_active: boolean }).is_active) {
    res.status(409).json({ error: "user already inactive" });
    return;
  }

  await db.query(
    "UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?",
    [new Date().toISOString(), id],
  );

  logger.info(`deactivated user ${id}`);
  res.json({ id, isActive: false });
}

export async function getUsersByRoleHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { role } = req.params;

  if (!["admin", "member", "guest"].includes(role)) {
    res.status(400).json({ error: "invalid role" });
    return;
  }

  const rows = await db.query(
    "SELECT * FROM users WHERE role = ? AND is_active = 1 ORDER BY name ASC",
    [role],
  );

  logger.info(`fetched ${rows.length} users with role=${role}`);
  res.json({ role, users: rows });
}

export async function searchUsersHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { q } = req.query as { q?: string };
  if (!q || q.trim().length < 2) {
    res.status(400).json({ error: "query must be at least 2 characters" });
    return;
  }

  const pattern = `%${q.trim()}%`;
  const rows = await db.query(
    "SELECT id, name, email, role FROM users WHERE (name LIKE ? OR email LIKE ?) AND is_active = 1 LIMIT 50",
    [pattern, pattern],
  );

  logger.info(`search "${q}" returned ${rows.length} users`);
  res.json({ query: q, results: rows });
}
