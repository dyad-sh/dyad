import { db } from "./db";
import { logger } from "./logger";

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UserAuditEntry {
  userId: string;
  action: string;
  performedBy: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

interface PaginatedUsers {
  items: User[];
  total: number;
  page: number;
}

// ── Basic CRUD ─────────────────────────────────────────────────────────────

export function fetchUser(id: string): Promise<User | null> {
  return db
    .query("SELECT * FROM users WHERE id = ?", [id])
    .then((rows) => {
      if (rows.length === 0) return null;
      return rows[0] as User;
    })
    .catch((err) => {
      logger.error(`fetchUser failed for id=${id}`, err);
      throw err;
    });
}

export function createUser(email: string, name: string): Promise<User> {
  return db
    .query("INSERT INTO users (email, name) VALUES (?, ?) RETURNING *", [
      email,
      name,
    ])
    .then((rows) => {
      const user = rows[0] as User;
      logger.info(`created user ${user.id}`);
      return user;
    })
    .catch((err) => {
      logger.error(`createUser failed for email=${email}`, err);
      throw err;
    });
}

export function deleteUser(id: string): Promise<void> {
  return db
    .query("DELETE FROM users WHERE id = ?", [id])
    .then(() => {
      logger.info(`deleted user ${id}`);
    })
    .catch((err) => {
      logger.error(`deleteUser failed for id=${id}`, err);
      throw err;
    });
}

export function updateEmail(id: string, email: string): Promise<User> {
  return fetchUser(id)
    .then((user) => {
      if (!user) throw new Error(`user ${id} not found`);
      return db.query("UPDATE users SET email = ? WHERE id = ? RETURNING *", [
        email,
        id,
      ]);
    })
    .then((rows) => rows[0] as User)
    .catch((err) => {
      logger.error(`updateEmail failed for id=${id}`, err);
      throw err;
    });
}

export function updateName(id: string, name: string): Promise<User> {
  return fetchUser(id)
    .then((user) => {
      if (!user) throw new Error(`user ${id} not found`);
      return db.query("UPDATE users SET name = ? WHERE id = ? RETURNING *", [
        name,
        id,
      ]);
    })
    .then((rows) => rows[0] as User)
    .catch((err) => {
      logger.error(`updateName failed for id=${id}`, err);
      throw err;
    });
}

export function updateRole(id: string, role: string): Promise<User> {
  return fetchUser(id)
    .then((user) => {
      if (!user) throw new Error(`user ${id} not found`);
      const validRoles = ["admin", "member", "guest"];
      if (!validRoles.includes(role)) throw new Error(`invalid role: ${role}`);
      return db.query("UPDATE users SET role = ? WHERE id = ? RETURNING *", [
        role,
        id,
      ]);
    })
    .then((rows) => rows[0] as User)
    .catch((err) => {
      logger.error(`updateRole failed for id=${id}`, err);
      throw err;
    });
}

export function deactivateUser(id: string): Promise<User> {
  return fetchUser(id)
    .then((user) => {
      if (!user) throw new Error(`user ${id} not found`);
      if (!user.isActive) throw new Error(`user ${id} is already inactive`);
      return db.query(
        "UPDATE users SET is_active = 0, updated_at = ? WHERE id = ? RETURNING *",
        [new Date().toISOString(), id],
      );
    })
    .then((rows) => {
      logger.info(`deactivated user ${id}`);
      return rows[0] as User;
    })
    .catch((err) => {
      logger.error(`deactivateUser failed for id=${id}`, err);
      throw err;
    });
}

export function reactivateUser(id: string): Promise<User> {
  return fetchUser(id)
    .then((user) => {
      if (!user) throw new Error(`user ${id} not found`);
      if (user.isActive) throw new Error(`user ${id} is already active`);
      return db.query(
        "UPDATE users SET is_active = 1, updated_at = ? WHERE id = ? RETURNING *",
        [new Date().toISOString(), id],
      );
    })
    .then((rows) => {
      logger.info(`reactivated user ${id}`);
      return rows[0] as User;
    })
    .catch((err) => {
      logger.error(`reactivateUser failed for id=${id}`, err);
      throw err;
    });
}

// ── Listing ────────────────────────────────────────────────────────────────

export function listUsers(
  page: number,
  limit: number,
): Promise<PaginatedUsers> {
  const offset = (page - 1) * limit;
  return db
    .query("SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?", [
      limit,
      offset,
    ])
    .then((rows) => {
      return db
        .query("SELECT COUNT(*) AS total FROM users", [])
        .then((countRows) => ({
          items: rows as User[],
          total: (countRows[0] as { total: number }).total,
          page,
        }));
    })
    .catch((err) => {
      logger.error(`listUsers failed page=${page}`, err);
      throw err;
    });
}

export function fetchUsersByRole(role: string): Promise<User[]> {
  return db
    .query("SELECT * FROM users WHERE role = ? AND is_active = 1", [role])
    .then((rows) => rows as User[])
    .catch((err) => {
      logger.error(`fetchUsersByRole failed for role=${role}`, err);
      throw err;
    });
}

export function searchUsers(query: string): Promise<User[]> {
  const pattern = `%${query}%`;
  return db
    .query(
      "SELECT * FROM users WHERE (name LIKE ? OR email LIKE ?) AND is_active = 1 LIMIT 50",
      [pattern, pattern],
    )
    .then((rows) => rows as User[])
    .catch((err) => {
      logger.error(`searchUsers failed for query=${query}`, err);
      throw err;
    });
}

// ── Audit ──────────────────────────────────────────────────────────────────

export function logAuditEntry(entry: UserAuditEntry): Promise<void> {
  return db
    .query(
      "INSERT INTO user_audit (user_id, action, performed_by, timestamp, metadata) VALUES (?, ?, ?, ?, ?)",
      [
        entry.userId,
        entry.action,
        entry.performedBy,
        entry.timestamp,
        JSON.stringify(entry.metadata),
      ],
    )
    .then(() => {
      logger.info(
        `audit: ${entry.action} on user ${entry.userId} by ${entry.performedBy}`,
      );
    })
    .catch((err) => {
      logger.error(`logAuditEntry failed for userId=${entry.userId}`, err);
      throw err;
    });
}

export function fetchAuditLog(userId: string): Promise<UserAuditEntry[]> {
  return db
    .query(
      "SELECT * FROM user_audit WHERE user_id = ? ORDER BY timestamp DESC LIMIT 100",
      [userId],
    )
    .then((rows) => rows as UserAuditEntry[])
    .catch((err) => {
      logger.error(`fetchAuditLog failed for userId=${userId}`, err);
      throw err;
    });
}

// ── Verification ───────────────────────────────────────────────────────────

export function requestEmailVerification(id: string): Promise<void> {
  return fetchUser(id)
    .then((user) => {
      if (!user) throw new Error(`user ${id} not found`);
      return db.query(
        "INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)",
        [
          id,
          Math.random().toString(36).slice(2),
          new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        ],
      );
    })
    .then(() => {
      logger.info(`requested email verification for user ${id}`);
    })
    .catch((err) => {
      logger.error(`requestEmailVerification failed for id=${id}`, err);
      throw err;
    });
}

export function verifyEmail(id: string, token: string): Promise<User> {
  return db
    .query(
      "SELECT * FROM email_verifications WHERE user_id = ? AND token = ? AND expires_at > ?",
      [id, token, new Date().toISOString()],
    )
    .then((rows) => {
      if (rows.length === 0)
        throw new Error("invalid or expired verification token");
      return db.query(
        "UPDATE users SET email_verified = 1 WHERE id = ? RETURNING *",
        [id],
      );
    })
    .then((rows) => {
      logger.info(`verified email for user ${id}`);
      return rows[0] as User;
    })
    .catch((err) => {
      logger.error(`verifyEmail failed for id=${id}`, err);
      throw err;
    });
}

// ── Password reset ─────────────────────────────────────────────────────────

export function requestPasswordReset(email: string): Promise<void> {
  return db
    .query("SELECT id FROM users WHERE email = ?", [email])
    .then((rows) => {
      if (rows.length === 0) {
        // Don't reveal whether the email exists
        logger.info(`password reset requested for unknown email (redacted)`);
        return;
      }
      const userId = (rows[0] as { id: string }).id;
      return db
        .query(
          "INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)",
          [
            userId,
            Math.random().toString(36).slice(2),
            new Date(Date.now() + 3600 * 1000).toISOString(),
          ],
        )
        .then(() => {
          logger.info(`password reset token created for user ${userId}`);
        });
    })
    .catch((err) => {
      logger.error(`requestPasswordReset failed for email`, err);
      throw err;
    });
}

export function resetPassword(
  token: string,
  newPasswordHash: string,
): Promise<void> {
  return db
    .query(
      "SELECT user_id FROM password_resets WHERE token = ? AND expires_at > ? AND used = 0",
      [token, new Date().toISOString()],
    )
    .then((rows) => {
      if (rows.length === 0) throw new Error("invalid or expired reset token");
      const userId = (rows[0] as { user_id: string }).user_id;
      return db
        .query(
          "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
          [newPasswordHash, new Date().toISOString(), userId],
        )
        .then(() =>
          db.query("UPDATE password_resets SET used = 1 WHERE token = ?", [
            token,
          ]),
        )
        .then(() => {
          logger.info(`password reset completed for user ${userId}`);
        });
    })
    .catch((err) => {
      logger.error(`resetPassword failed`, err);
      throw err;
    });
}
