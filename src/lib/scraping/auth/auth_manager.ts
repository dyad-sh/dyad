/**
 * Auth Manager — Session persistence, cookie import, and automated login.
 *
 * Integrates with the Secrets Vault for credential storage and supports
 * importing cookies from browser profiles.
 */

import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import log from "electron-log";
import type { Page } from "playwright-core";
import type { CookieEntry, LoginConfig, SavedSession } from "../types";

const logger = log.scope("scraping:auth");

const SESSIONS_DIR = (): string =>
  path.join(app.getPath("userData"), "scraping-sessions");

// ── Session storage ─────────────────────────────────────────────────────────

function ensureSessionsDir(): void {
  const dir = SESSIONS_DIR();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Save a browser session (cookies + storage) for later reuse.
 */
export async function saveSession(session: SavedSession): Promise<void> {
  ensureSessionsDir();
  const filePath = path.join(SESSIONS_DIR(), `${session.id}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
  logger.info(`Saved session ${session.id} for ${session.domain}`);
}

/**
 * Load a saved session by ID.
 */
export async function loadSession(id: string): Promise<SavedSession | null> {
  const filePath = path.join(SESSIONS_DIR(), `${id}.json`);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as SavedSession;
  } catch {
    return null;
  }
}

/**
 * List all saved sessions.
 */
export async function listSessions(): Promise<SavedSession[]> {
  ensureSessionsDir();
  const files = await fs.promises.readdir(SESSIONS_DIR());
  const sessions: SavedSession[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fs.promises.readFile(
        path.join(SESSIONS_DIR(), file),
        "utf-8",
      );
      sessions.push(JSON.parse(raw));
    } catch {
      // corrupted session file — skip
    }
  }

  return sessions;
}

/**
 * Delete a saved session.
 */
export async function deleteSession(id: string): Promise<void> {
  const filePath = path.join(SESSIONS_DIR(), `${id}.json`);
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // already gone
  }
}

// ── Cookie extraction from page ─────────────────────────────────────────────

/**
 * Extract current cookies from a Playwright page and save as a session.
 */
export async function captureSession(
  page: Page,
  name: string,
): Promise<SavedSession> {
  const context = page.context();
  const rawCookies = await context.cookies();
  const url = new URL(page.url());

  const cookies: CookieEntry[] = rawCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite as CookieEntry["sameSite"],
  }));

  const localStorage = await page
    .evaluate(() => {
      const data: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) data[key] = window.localStorage.getItem(key) ?? "";
      }
      return data;
    })
    .catch(() => ({}));

  const session: SavedSession = {
    id: crypto.randomUUID(),
    name,
    domain: url.hostname,
    cookies,
    localStorage,
    createdAt: new Date(),
  };

  await saveSession(session);
  return session;
}

// ── Inject session into page ────────────────────────────────────────────────

/**
 * Inject a saved session's cookies into a Playwright browser context.
 */
export async function injectSession(
  page: Page,
  session: SavedSession,
): Promise<void> {
  const context = page.context();

  // Inject cookies
  if (session.cookies.length > 0) {
    await context.addCookies(
      session.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires ?? -1,
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? false,
        sameSite: (c.sameSite as "Strict" | "Lax" | "None") ?? "Lax",
      })),
    );
  }

  // Inject localStorage
  if (session.localStorage && Object.keys(session.localStorage).length > 0) {
    const url = `https://${session.domain}`;
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.evaluate((data) => {
      for (const [key, value] of Object.entries(data)) {
        window.localStorage.setItem(key, value);
      }
    }, session.localStorage);
  }

  logger.info(`Injected session ${session.id} for ${session.domain}`);
}

// ── Automated login ─────────────────────────────────────────────────────────

/**
 * Perform automated login on a Playwright page using form selectors.
 */
export async function performLogin(
  page: Page,
  config: LoginConfig,
): Promise<SavedSession> {
  logger.info(`Performing login at ${config.url}`);

  await page.goto(config.url, { waitUntil: "domcontentloaded" });

  // Fill credentials
  await page.fill(config.usernameSelector, config.username);
  await page.waitForTimeout(300 + Math.random() * 200);
  await page.fill(config.passwordSelector, config.password);
  await page.waitForTimeout(300 + Math.random() * 200);

  // Submit
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click(config.submitSelector),
  ]);

  // Wait for post-login state
  if (config.waitForSelector) {
    await page.waitForSelector(config.waitForSelector, { timeout: 15_000 });
  }

  // Capture the session
  const domain = new URL(config.url).hostname;
  return captureSession(page, `login-${domain}`);
}

// ── Cookie import from browser profiles ─────────────────────────────────────

/**
 * Import cookies from a Netscape-format cookie file (common export format).
 */
export function parseCookieFile(content: string): CookieEntry[] {
  const cookies: CookieEntry[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split("\t");
    if (parts.length < 7) continue;

    cookies.push({
      domain: parts[0],
      path: parts[2],
      secure: parts[3].toLowerCase() === "true",
      expires: Number.parseInt(parts[4], 10) || undefined,
      name: parts[5],
      value: parts[6],
    });
  }

  return cookies;
}

/**
 * Create a session from imported cookies.
 */
export async function importCookiesAsSession(
  name: string,
  domain: string,
  cookies: CookieEntry[],
): Promise<SavedSession> {
  const session: SavedSession = {
    id: crypto.randomUUID(),
    name,
    domain,
    cookies,
    createdAt: new Date(),
  };

  await saveSession(session);
  return session;
}
