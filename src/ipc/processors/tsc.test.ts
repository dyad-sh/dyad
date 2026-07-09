import { describe, expect, it } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { shouldFilterTelemetryException } from "@/ipc/utils/telemetry";
import {
  getTypeCheckPreconditionKind,
  toProblemReportError,
  TypeCheckPreconditionError,
} from "./tsc";

describe("toProblemReportError", () => {
  it("propagates structured worker error kinds", () => {
    const error = toProblemReportError(
      new Error("Cannot find module 'typescript'"),
      "typescript-not-found",
    );

    expect(error).toBeInstanceOf(TypeCheckPreconditionError);
    expect((error as TypeCheckPreconditionError).kind).toBe(
      DyadErrorKind.Precondition,
    );
    expect(getTypeCheckPreconditionKind(error)).toBe("typescript-not-found");
    expect(shouldFilterTelemetryException(error)).toBe(true);
  });

  it("classifies missing TypeScript as a filtered precondition error", () => {
    const error = toProblemReportError(
      new Error(
        "Failed to load TypeScript from C:\\Users\\jazzm\\dyad-apps\\wandering-koala-nudge because of Error: Cannot find module 'typescript'",
      ),
    );

    expect(error).toBeInstanceOf(DyadError);
    expect((error as DyadError).kind).toBe(DyadErrorKind.Precondition);
    expect(getTypeCheckPreconditionKind(error)).toBe("typescript-not-found");
    expect(shouldFilterTelemetryException(error)).toBe(true);
  });

  it("classifies missing tsconfig as a filtered precondition error", () => {
    const error = toProblemReportError(
      new Error(
        "No TypeScript configuration file found in /app. Expected one of: tsconfig.app.json, tsconfig.json",
      ),
    );

    expect(error).toBeInstanceOf(DyadError);
    expect((error as DyadError).kind).toBe(DyadErrorKind.Precondition);
    expect(getTypeCheckPreconditionKind(error)).toBe("tsconfig-not-found");
    expect(shouldFilterTelemetryException(error)).toBe(true);
  });

  it("preserves unexpected worker failures for telemetry", () => {
    const error = toProblemReportError(
      new Error("TypeScript config error: invalid compiler option"),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DyadError);
    expect(shouldFilterTelemetryException(error)).toBe(false);
  });
});
