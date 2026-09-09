import type { Request, Response } from "express";

/** Keep authentication failures consistent across fake OpenAI transports. */
export function respondToInvalidApiKey(
  req: Request,
  res: Response,
  prefix: string,
): boolean {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !/invalid/i.test(authorization)) {
    return false;
  }

  // The engine reports auth failures inside an HTTP 200 SSE response.
  if (prefix === "engine") {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.write(
      `event: error\ndata: ${JSON.stringify({
        type: "error",
        sequence_number: 0,
        error: {
          message:
            "401 LiteLLM Virtual Key expected. Received=inva****-key, expected to start with 'sk-'.",
          type: "server_error",
          code: "invalid_api_key",
          param: null,
        },
      })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    res.status(401).json({
      error: {
        message: "Invalid API key",
        type: "authentication_error",
        param: null,
        code: "invalid_api_key",
      },
    });
  }
  return true;
}
