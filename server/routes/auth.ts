/**
 * Authentication routes for ProteaAI web server.
 *
 * POST /auth/register  — create account
 * POST /auth/login     — returns { token, user }
 * POST /auth/logout    — client-side only (JWT is stateless); included for convention
 * GET  /auth/me        — returns current user from JWT
 */

import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { db } from "../../src/db";
import { users, subscriptions, userSettings } from "../../src/db/schema";
import { eq } from "drizzle-orm";

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "proteaai-dev-secret-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "7d";
const BCRYPT_ROUNDS = 12;

function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as string,
  });
}

function userResponse(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}

// ── POST /auth/register ───────────────────────────────────────────────────────

authRouter.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body as {
      email?: string;
      password?: string;
      name?: string;
    };

    if (!email || !password) {
      res.status(400).json({ ok: false, error: "Email and password are required" });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
      return;
    }

    const existing = await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase().trim()),
    });

    if (existing) {
      res.status(409).json({ ok: false, error: "Email already registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = uuidv4();

    await db.insert(users).values({
      id: userId,
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name?.trim() ?? null,
      role: "user",
    });

    // Create free subscription
    await db.insert(subscriptions).values({
      id: uuidv4(),
      userId,
      stripeCustomerId: "",
      status: "active",
      plan: "free",
    });

    // Create empty settings row
    await db.insert(userSettings).values({
      userId,
      settingsJson: "{}",
    });

    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const token = signToken(userId);

    res.status(201).json({ ok: true, data: { token, user: userResponse(user!) } });
  } catch (err) {
    console.error("[auth/register]", err);
    res.status(500).json({ ok: false, error: "Registration failed" });
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ ok: false, error: "Email and password are required" });
      return;
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, email.toLowerCase().trim()),
    });

    if (!user) {
      res.status(401).json({ ok: false, error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ ok: false, error: "Invalid credentials" });
      return;
    }

    const token = signToken(user.id);
    res.json({ ok: true, data: { token, user: userResponse(user) } });
  } catch (err) {
    console.error("[auth/login]", err);
    res.status(500).json({ ok: false, error: "Login failed" });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

authRouter.post("/logout", (_req, res) => {
  // JWTs are stateless — client must delete the token.
  // If token blocklist is needed in future, add it here.
  res.json({ ok: true });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────

authRouter.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const token = authHeader.slice(7);
    let payload: { sub: string };
    try {
      payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    } catch {
      res.status(401).json({ ok: false, error: "Invalid or expired token" });
      return;
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.sub),
      with: { subscription: true },
    });

    if (!user) {
      res.status(404).json({ ok: false, error: "User not found" });
      return;
    }

    res.json({
      ok: true,
      data: {
        ...userResponse(user),
        plan: user.subscription?.plan ?? "free",
        subscriptionStatus: user.subscription?.status ?? "active",
      },
    });
  } catch (err) {
    console.error("[auth/me]", err);
    res.status(500).json({ ok: false, error: "Failed to fetch user" });
  }
});
