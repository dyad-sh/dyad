/**
 * safeRoute middleware for ProteaAI web server.
 * Wraps Express route handlers with error catching and JSON response formatting.
 */

import type { Request, Response, NextFunction } from "express";

type RouteHandler = (req: Request) => Promise<unknown>;

/**
 * Wraps an async route handler, catching errors and returning JSON responses.
 *
 * @example
 * router.post("/my:channel", safeRoute("my:channel", async (req) => {
 *   const params = req.body;
 *   return await doSomething(params);
 * }));
 */
export function safeRoute(
  channel: string,
  handler: RouteHandler,
): (req: Request, res: Response, next: NextFunction) => void {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await handler(req);
      res.json({ ok: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${channel}] Handler error:`, message);
      const isProd = process.env.NODE_ENV === "production";
      res.status(500).json({
        ok: false,
        error: isProd ? "Internal server error" : message,
        channel: isProd ? undefined : channel,
      });
      // Don't call next(err) — we've already sent the response
    }
  };
}
