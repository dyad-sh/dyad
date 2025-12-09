/**
 * Request logging middleware
 */

import { Request, Response, NextFunction } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();

    res.on("finish", () => {
        const duration = Date.now() - start;
        const log = `[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} - ${duration}ms`;

        if (res.statusCode >= 400) {
            console.error(log);
        } else {
            console.log(log);
        }
    });

    next();
}
