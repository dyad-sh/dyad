import { describe, expect, it } from "vitest";
import { ImageGenerationOperationOutcomeSchema } from "./image_generation";

describe("ImageGenerationOperationOutcomeSchema", () => {
  it("rejects Error instances decorated like a domain failure", () => {
    const error = Object.assign(new Error("provider failed"), {
      kind: "failed",
      jobId: "job:1",
      message: "provider failed",
      failureKind: "provider",
    });

    expect(ImageGenerationOperationOutcomeSchema.safeParse(error).success).toBe(
      false,
    );
  });

  it("accepts a plain typed provider failure", () => {
    expect(
      ImageGenerationOperationOutcomeSchema.parse({
        kind: "failed",
        jobId: "job:1",
        message: "provider failed",
        failureKind: "provider",
      }),
    ).toEqual({
      kind: "failed",
      jobId: "job:1",
      message: "provider failed",
      failureKind: "provider",
    });
  });
});
