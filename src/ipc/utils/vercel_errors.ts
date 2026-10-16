import { ResponseValidationError } from "@vercel/sdk/models/responsevalidationerror.js";
import { VercelError } from "@vercel/sdk/models/vercelerror.js";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

function getVercelErrorKind(status: number): DyadErrorKind {
  switch (status) {
    case 400:
    case 422:
      return DyadErrorKind.Validation;
    case 401:
    case 403:
      return DyadErrorKind.Auth;
    case 402:
    case 428:
      return DyadErrorKind.Precondition;
    case 404:
    case 410:
      return DyadErrorKind.NotFound;
    case 409:
      return DyadErrorKind.Conflict;
    case 429:
      return DyadErrorKind.RateLimited;
    default:
      return DyadErrorKind.External;
  }
}

function getResponseErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("error" in value) {
    const nested = value.error;
    if (
      nested &&
      typeof nested === "object" &&
      "message" in nested &&
      typeof nested.message === "string" &&
      nested.message.trim()
    ) {
      return nested.message.trim();
    }
  }
  if ("message" in value && typeof value.message === "string") {
    return value.message.trim() || undefined;
  }
  return undefined;
}

/** Deployment recovery guidance must not expose the SDK's raw response body. */
export function getVercelDeploymentError(error: unknown): Error {
  if (error instanceof VercelError) {
    let guidance: string;
    switch (error.statusCode) {
      case 401:
      case 403:
        guidance =
          "Reconnect Vercel with a token that has access to this project and its team, then retry.";
        break;
      case 404:
      case 410:
        guidance =
          "The Vercel project could not be found. Reconnect an existing project in Publish, then retry.";
        break;
      case 400:
      case 422:
        guidance =
          "Check that the connected GitHub repository and branch exist and that the Vercel GitHub integration has access, then retry.";
        break;
      case 429:
        guidance = "Vercel's rate limit was reached. Wait a moment and retry.";
        break;
      default:
        guidance =
          error.statusCode >= 200 && error.statusCode < 300
            ? "Dyad could not read Vercel's response. Check the Vercel dashboard for a deployment before retrying."
            : "Vercel could not start the deployment. Check the project in Vercel and retry in a moment.";
    }
    return new DyadError(
      `Vercel deployment failed (HTTP ${error.statusCode}). ${guidance}`,
      error.statusCode === 400 || error.statusCode === 422
        ? DyadErrorKind.Precondition
        : getVercelErrorKind(error.statusCode),
    );
  }
  return error instanceof Error
    ? error
    : new Error("Failed to start a Vercel deployment.");
}

export function getVercelProjectCreationError(error: unknown): Error {
  if (error instanceof VercelError) {
    // Surface the API's error message, not the entire project response (which
    // can include environment variables). Keep provider wording for diagnosis.
    // Telemetry for vercel:create-project reports only a fixed classification.
    let detail: string | undefined;
    if (error.body.length <= 100_000) {
      try {
        detail = getResponseErrorMessage(JSON.parse(error.body));
      } catch {
        // Non-JSON responses may still have the SDK's validation cause below.
      }
    }
    if (error instanceof ResponseValidationError) {
      detail ??= getResponseErrorMessage(error.rawValue);
      detail ??= getResponseErrorMessage(error.cause);
    }
    const fallback =
      error instanceof ResponseValidationError
        ? "Dyad couldn't read Vercel's response while setting up your project."
        : "Vercel rejected the project setup request without an error message.";
    const recovery =
      error.statusCode >= 200 && error.statusCode < 300
        ? ' The project may already have been created. Check your Vercel dashboard; if it exists, choose "Connect to existing project" in the Publish panel before retrying.'
        : "";

    return new DyadError(
      `Vercel project setup failed (HTTP ${error.statusCode}): ${(detail || fallback).slice(0, 4000)}${recovery}`,
      getVercelErrorKind(error.statusCode),
    );
  }

  return error instanceof Error
    ? error
    : new Error("Failed to create Vercel project.");
}
