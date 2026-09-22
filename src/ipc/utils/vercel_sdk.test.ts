import { describe, expect, it } from "vitest";
import { CreateProjectProjectsResourceConfig$inboundSchema } from "@vercel/sdk/models/createprojecttargets.js";

describe("Vercel SDK project response compatibility", () => {
  it("accepts the basic build machine returned by Vercel", () => {
    // This successful API response failed validation in SDK 1.18.0,
    // preventing Dyad from linking a newly created project.
    const resourceConfig = {
      functionDefaultRegions: ["iad1"],
      buildMachineType: "basic",
    };

    expect(
      CreateProjectProjectsResourceConfig$inboundSchema.parse(resourceConfig),
    ).toEqual(resourceConfig);
  });
});
