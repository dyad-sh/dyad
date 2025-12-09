/**
 * Global error handler middleware
 */

import { Request, Response, NextFunction } from "express";

export interface ApiError extends Error {
    statusCode?: number;
    code?: string;
}

export function errorHandler(
    err: ApiError,
    req: Request,
    res: Response,
    next: NextFunction
) {
    console.error(`[ERROR] ${req.method} ${req.path}:`, err);

    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const code = err.code || "INTERNAL_ERROR";

    res.status(statusCode).json({
        success: false,
        error: {
            message,
            code,
            ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
        },
    });
}

export function createError(
    message: string,
    statusCode: number = 500,
    code?: string
): ApiError {
    const error: ApiError = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}
