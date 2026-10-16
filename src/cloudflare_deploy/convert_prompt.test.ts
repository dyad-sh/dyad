import { describe, expect, it } from "vitest";
import { buildCloudflareNitroConversionPrompt } from "./convert_prompt";

describe("buildCloudflareNitroConversionPrompt", () => {
  it("asks for the tool by name and for nothing beyond the server layer", () => {
    const prompt = buildCloudflareNitroConversionPrompt();

    expect(prompt).toContain("Cloudflare Workers");
    expect(prompt).toContain("`enable_nitro` tool");
    expect(prompt).toContain("rather than writing the Nitro files by hand");
    expect(prompt).toContain("add no routes");
    expect(prompt).toContain("If the tool is not available, say so and stop.");
  });
});
