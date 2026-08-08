import { describe, expect, it } from "vitest";

import {
  CreateVercelManagerProjectParamsSchema,
  DeleteVercelManagerProjectParamsSchema,
  UpdateVercelManagerProjectParamsSchema,
} from "./vercel";

describe("Vercel manager project schemas", () => {
  it("normalizes valid create and rename requests", () => {
    expect(
      CreateVercelManagerProjectParamsSchema.parse({ name: "  storefront " }),
    ).toEqual({ name: "storefront" });
    expect(
      UpdateVercelManagerProjectParamsSchema.parse({
        projectId: "prj_123",
        name: "  storefront-v2 ",
      }),
    ).toEqual({ projectId: "prj_123", name: "storefront-v2" });
  });

  it("rejects empty names and project ids", () => {
    expect(() =>
      CreateVercelManagerProjectParamsSchema.parse({ name: "   " }),
    ).toThrow();
    expect(() =>
      DeleteVercelManagerProjectParamsSchema.parse({ projectId: "" }),
    ).toThrow();
  });
});
