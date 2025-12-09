/**
 * Health check routes
 */

import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
    res.json({
        success: true,
        data: {
            status: "healthy",
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || "0.1.0",
        },
    });
});

router.get("/ready", (req, res) => {
    // TODO: Add database connection check
    res.json({
        success: true,
        data: {
            status: "ready",
            database: "connected",
        },
    });
});

export default router;
