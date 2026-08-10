import { describe, expect, it } from "vitest";

import { normaliseAgentEndpoint } from "@/ipc/handlers/agent_os_handlers";

/**
 * Endpoints are pasted, and what gets pasted is often the label too.
 *
 * The failure this prevents is specific and was real: a saved endpoint of
 * "URL https://…" passed the form, failed the http check at chat time, and
 * reported that the agent had no endpoint configured while the field plainly
 * showed one.
 */
describe("normaliseAgentEndpoint", () => {
  const url = "https://capsulepie.tail7890ea.ts.net/openai/v1/chat/completions";

  it("strips a pasted URL label", () => {
    expect(normaliseAgentEndpoint(`URL ${url}`)).toBe(url);
  });

  it("strips other common labels, with or without a colon", () => {
    expect(normaliseAgentEndpoint(`Endpoint: ${url}`)).toBe(url);
    expect(normaliseAgentEndpoint(`Base URL ${url}`)).toBe(url);
    expect(normaliseAgentEndpoint(`api: ${url}`)).toBe(url);
  });

  it("unwraps angle brackets and markdown link syntax", () => {
    expect(normaliseAgentEndpoint(`<${url}>`)).toBe(url);
    expect(normaliseAgentEndpoint(`[${url}]`)).toBe(url);
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseAgentEndpoint(`   ${url}  `)).toBe(url);
  });

  it("leaves a clean endpoint untouched", () => {
    expect(normaliseAgentEndpoint(url)).toBe(url);
  });

  it("does not eat a path segment that merely looks like a label", () => {
    // "api" as part of the host or path is not a label to strip.
    const withApi = "https://example.com/api/v1/chat/completions";
    expect(normaliseAgentEndpoint(withApi)).toBe(withApi);
  });

  it("survives an empty value", () => {
    expect(normaliseAgentEndpoint("")).toBe("");
    expect(normaliseAgentEndpoint("   ")).toBe("");
  });
});
