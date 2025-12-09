/**
 * GitHub API routes
 * Migrated from: src/ipc/handlers/github_handlers.ts
 * Note: OAuth flow adapted for web (server-side sessions instead of Electron device flow)
 */

import { Router } from "express";
import { z } from "zod";
import { createError } from "../middleware/errorHandler.js";
import { getDb } from "../db/index.js";
import { apps } from "../db/schema.js";
import { eq } from "drizzle-orm";
import git from "isomorphic-git";
// @ts-ignore - isomorphic-git types are incomplete
import http from "isomorphic-git/http/node";
import fs from "node:fs";
import path from "node:path";

const router = Router();

// GitHub API configuration
const GITHUB_API_BASE = process.env.GITHUB_API_URL || "https://api.github.com";
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";

// Simple in-memory token store (replace with session/DB in production)
let githubAccessToken: string | null = null;

/**
 * GET /api/github/status - Check GitHub connection status
 */
router.get("/status", async (req, res, next) => {
    try {
        if (!githubAccessToken) {
            return res.json({
                success: true,
                data: { connected: false },
            });
        }

        // Verify token is still valid
        const response = await fetch(`${GITHUB_API_BASE}/user`, {
            headers: { Authorization: `Bearer ${githubAccessToken}` },
        });

        if (!response.ok) {
            githubAccessToken = null;
            return res.json({
                success: true,
                data: { connected: false },
            });
        }

        const user = await response.json() as any;
        res.json({
            success: true,
            data: {
                connected: true,
                user: { login: user.login, email: user.email },
            },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/github/connect - Connect with GitHub access token
 */
router.post("/connect", async (req, res, next) => {
    try {
        const { accessToken } = z.object({ accessToken: z.string() }).parse(req.body);

        // Verify token
        const response = await fetch(`${GITHUB_API_BASE}/user`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) {
            throw createError("Invalid GitHub access token", 401, "INVALID_TOKEN");
        }

        githubAccessToken = accessToken;
        const user = await response.json() as any;

        res.json({
            success: true,
            data: {
                connected: true,
                user: { login: user.login, email: user.email },
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: { message: "accessToken is required", code: "VALIDATION_ERROR" },
            });
        }
        next(error);
    }
});

/**
 * POST /api/github/disconnect - Disconnect from GitHub
 */
router.post("/disconnect", async (req, res, next) => {
    try {
        githubAccessToken = null;
        res.json({
            success: true,
            data: { connected: false },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/github/repos - List user's repositories
 */
router.get("/repos", async (req, res, next) => {
    try {
        if (!githubAccessToken) {
            throw createError("Not connected to GitHub", 401, "NOT_CONNECTED");
        }

        const response = await fetch(
            `${GITHUB_API_BASE}/user/repos?per_page=100&sort=updated`,
            {
                headers: {
                    Authorization: `Bearer ${githubAccessToken}`,
                    Accept: "application/vnd.github+json",
                },
            }
        );

        if (!response.ok) {
            throw createError("Failed to fetch repositories", response.status);
        }

        const repos = await response.json() as any;
        res.json({
            success: true,
            data: repos.map((repo: any) => ({
                name: repo.name,
                full_name: repo.full_name,
                private: repo.private,
                default_branch: repo.default_branch,
            })),
        });
    } catch (error) {
        next(error);
    }
});

/**
 * GET /api/github/repos/:owner/:repo/branches - Get repository branches
 */
router.get("/repos/:owner/:repo/branches", async (req, res, next) => {
    try {
        if (!githubAccessToken) {
            throw createError("Not connected to GitHub", 401, "NOT_CONNECTED");
        }

        const { owner, repo } = req.params;
        const response = await fetch(
            `${GITHUB_API_BASE}/repos/${owner}/${repo}/branches`,
            {
                headers: {
                    Authorization: `Bearer ${githubAccessToken}`,
                    Accept: "application/vnd.github+json",
                },
            }
        );

        if (!response.ok) {
            throw createError("Failed to fetch branches", response.status);
        }

        const branches = await response.json() as any;
        res.json({
            success: true,
            data: branches.map((branch: any) => ({
                name: branch.name,
                commit: { sha: branch.commit.sha },
            })),
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/github/repos - Create a new repository
 */
router.post("/repos", async (req, res, next) => {
    try {
        if (!githubAccessToken) {
            throw createError("Not connected to GitHub", 401, "NOT_CONNECTED");
        }

        const { name, org, isPrivate = true } = z.object({
            name: z.string(),
            org: z.string().optional(),
            isPrivate: z.boolean().optional(),
        }).parse(req.body);

        const createUrl = org
            ? `${GITHUB_API_BASE}/orgs/${org}/repos`
            : `${GITHUB_API_BASE}/user/repos`;

        const response = await fetch(createUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${githubAccessToken}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.github+json",
            },
            body: JSON.stringify({ name, private: isPrivate }),
        });

        if (!response.ok) {
            const data = await response.json() as any;
            throw createError(data.message || "Failed to create repository", response.status);
        }

        const repo = await response.json() as any;
        res.status(201).json({
            success: true,
            data: {
                name: repo.name,
                full_name: repo.full_name,
                clone_url: repo.clone_url,
                html_url: repo.html_url,
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: { message: "Validation error", code: "VALIDATION_ERROR", details: error.errors },
            });
        }
        next(error);
    }
});

/**
 * POST /api/github/push/:appId - Push app to GitHub
 */
router.post("/push/:appId", async (req, res, next) => {
    try {
        if (!githubAccessToken) {
            throw createError("Not connected to GitHub", 401, "NOT_CONNECTED");
        }

        const { appId } = req.params;
        const { force = false } = req.body;
        const db = getDb();

        const app = await db.select().from(apps).where(eq(apps.id, Number(appId))).limit(1);
        if (!app.length || !app[0].githubOrg || !app[0].githubRepo) {
            throw createError("App not linked to GitHub", 400, "NOT_LINKED");
        }

        const appData = app[0];

        // In web mode, path may be null - return error if so
        if (!appData.path) {
            return res.status(400).json({
                success: false,
                error: { message: "App path not configured. This operation requires a local file system path.", code: "NO_PATH" }
            });
        }

        const appsDir = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "apps") : "./data/apps";
        const appPath = path.join(appsDir, appData.path);
        const branch = appData.githubBranch || "main";

        // Set up remote URL with token
        const remoteUrl = `https://${githubAccessToken}:x-oauth-basic@github.com/${appData.githubOrg}/${appData.githubRepo}.git`;

        await git.setConfig({
            fs,
            dir: appPath,
            path: "remote.origin.url",
            value: remoteUrl,
        });

        await git.push({
            fs,
            http,
            dir: appPath,
            remote: "origin",
            ref: "main",
            remoteRef: branch,
            onAuth: () => ({
                username: githubAccessToken!,
                password: "x-oauth-basic",
            }),
            force: !!force,
        });

        res.json({
            success: true,
            data: { pushed: true },
        });
    } catch (error) {
        next(error);
    }
});

/**
 * POST /api/github/link/:appId - Link app to GitHub repo
 */
router.post("/link/:appId", async (req, res, next) => {
    try {
        const { appId } = req.params;
        const { owner, repo, branch = "main" } = z.object({
            owner: z.string(),
            repo: z.string(),
            branch: z.string().optional(),
        }).parse(req.body);

        const db = getDb();

        await db.update(apps).set({
            githubOrg: owner,
            githubRepo: repo,
            githubBranch: branch,
            updatedAt: new Date(),
        }).where(eq(apps.id, Number(appId)));

        res.json({
            success: true,
            data: { linked: true, owner, repo, branch },
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({
                success: false,
                error: { message: "Validation error", code: "VALIDATION_ERROR", details: error.errors },
            });
        }
        next(error);
    }
});

/**
 * DELETE /api/github/link/:appId - Unlink app from GitHub
 */
router.delete("/link/:appId", async (req, res, next) => {
    try {
        const { appId } = req.params;
        const db = getDb();

        await db.update(apps).set({
            githubOrg: null,
            githubRepo: null,
            githubBranch: null,
            updatedAt: new Date(),
        }).where(eq(apps.id, Number(appId)));

        res.json({
            success: true,
            data: { unlinked: true },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
