/**
 * Logs API route
 * Provides access to application logs
 */

import { Router } from "express";
import fs from "fs";
import path from "path";
import os from "os";

const router = Router();

// In-memory log buffer for real-time logs
const logBuffer: Array<{ timestamp: string; level: string; message: string; source: string }> = [];
const MAX_BUFFER_SIZE = 1000;

// Intercept console methods to capture logs
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function addLogEntry(level: string, message: string, source = "server") {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message: typeof message === "string" ? message : JSON.stringify(message),
        source,
    };
    logBuffer.push(entry);
    if (logBuffer.length > MAX_BUFFER_SIZE) {
        logBuffer.shift();
    }
}

// Override console methods
console.log = (...args: any[]) => {
    addLogEntry("INFO", args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
    originalConsoleLog.apply(console, args);
};

console.error = (...args: any[]) => {
    addLogEntry("ERROR", args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
    originalConsoleError.apply(console, args);
};

console.warn = (...args: any[]) => {
    addLogEntry("WARN", args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
    originalConsoleWarn.apply(console, args);
};

/**
 * GET /api/logs - Get recent logs
 * Query params:
 *   - level: filter by log level (INFO, WARN, ERROR)
 *   - limit: max number of logs to return (default 100)
 *   - source: filter by source
 */
router.get("/", (req, res) => {
    try {
        const { level, limit = "100", source } = req.query;

        let logs = [...logBuffer];

        // Filter by level
        if (level && typeof level === "string") {
            logs = logs.filter(log => log.level === level.toUpperCase());
        }

        // Filter by source
        if (source && typeof source === "string") {
            logs = logs.filter(log => log.source === source);
        }

        // Limit results
        const limitNum = Math.min(parseInt(limit as string, 10) || 100, MAX_BUFFER_SIZE);
        logs = logs.slice(-limitNum);

        res.json({
            success: true,
            data: {
                logs,
                total: logs.length,
                bufferSize: logBuffer.length,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: { message: "Failed to fetch logs" },
        });
    }
});

/**
 * GET /api/logs/stats - Get log statistics
 */
router.get("/stats", (req, res) => {
    const stats = {
        total: logBuffer.length,
        byLevel: {
            INFO: logBuffer.filter(l => l.level === "INFO").length,
            WARN: logBuffer.filter(l => l.level === "WARN").length,
            ERROR: logBuffer.filter(l => l.level === "ERROR").length,
        },
    };

    res.json({
        success: true,
        data: stats,
    });
});

/**
 * DELETE /api/logs - Clear logs
 */
router.delete("/", (req, res) => {
    logBuffer.length = 0;
    res.json({
        success: true,
        data: { cleared: true },
    });
});

export default router;
