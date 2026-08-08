import { describe, expect, it } from "vitest";

import {
  cachedImageUrl,
  parseAgentReply,
  resolveImageBaseUrl,
  rewriteCachedImagePaths,
} from "@/ipc/utils/hermes_image_urls";

const HERMES = "https://jarvis.tail7890ea.ts.net/openai/v1";
const IMAGES = "https://jarvis.tail7890ea.ts.net/images";
const CACHED = "/home/jarvis/.hermes/cache/images/gen_1234.png";

describe("resolveImageBaseUrl", () => {
  it("derives the images mount from the endpoint origin", () => {
    expect(resolveImageBaseUrl(HERMES)).toBe(IMAGES);
  });

  it("ignores the endpoint path, however deep", () => {
    expect(
      resolveImageBaseUrl("https://host:8080/a/b/c/chat/completions"),
    ).toBe("https://host:8080/images");
  });

  it("prefers an explicit override", () => {
    expect(resolveImageBaseUrl(HERMES, "https://cdn.example.com/img/")).toBe(
      "https://cdn.example.com/img",
    );
  });

  it("returns nothing for a non-http endpoint", () => {
    expect(resolveImageBaseUrl("mcp://tools")).toBeUndefined();
    expect(resolveImageBaseUrl("")).toBeUndefined();
    expect(resolveImageBaseUrl(null)).toBeUndefined();
  });

  it("rejects an override that is not a URL rather than guessing", () => {
    expect(resolveImageBaseUrl(HERMES, "/var/images")).toBeUndefined();
  });
});

describe("cachedImageUrl", () => {
  it("joins base and filename", () => {
    expect(cachedImageUrl(IMAGES, "a.png")).toBe(`${IMAGES}/a.png`);
  });

  it("escapes a filename with spaces", () => {
    expect(cachedImageUrl(IMAGES, "my render.png")).toBe(
      `${IMAGES}/my%20render.png`,
    );
  });
});

describe("rewriteCachedImagePaths", () => {
  it("maps a cache path onto the served URL", () => {
    const { text, urls } = rewriteCachedImagePaths(
      `Saved to ${CACHED}`,
      IMAGES,
    );
    expect(text).toBe(`Saved to ${IMAGES}/gen_1234.png`);
    expect(urls).toEqual([`${IMAGES}/gen_1234.png`]);
  });

  it("leaves paths outside a cache/images directory alone", () => {
    const text = "Your report is at /home/jarvis/reports/chart.png";
    expect(rewriteCachedImagePaths(text, IMAGES).text).toBe(text);
  });

  it("does not invent URLs when there is no base", () => {
    const result = rewriteCachedImagePaths(`Saved to ${CACHED}`, undefined);
    expect(result.text).toContain(CACHED);
    expect(result.urls).toEqual([]);
  });

  it("reports each URL once even when the path repeats", () => {
    const { urls } = rewriteCachedImagePaths(`${CACHED} and ${CACHED}`, IMAGES);
    expect(urls).toHaveLength(1);
  });
});

describe("parseAgentReply", () => {
  it("renders a markdown image written against a local path", () => {
    const parsed = parseAgentReply(
      `Here you go: ![render](${CACHED})`,
      undefined,
      IMAGES,
    );
    expect(parsed.images).toEqual([`${IMAGES}/gen_1234.png`]);
    expect(parsed.text).not.toContain(CACHED);
  });

  it("picks up a bare path in prose and removes it from the text", () => {
    const parsed = parseAgentReply(
      `All done.\n${CACHED}\nAnything else?`,
      undefined,
      IMAGES,
    );
    expect(parsed.images).toEqual([`${IMAGES}/gen_1234.png`]);
    expect(parsed.text).not.toContain("gen_1234.png");
    expect(parsed.text).toContain("All done.");
    expect(parsed.text).toContain("Anything else?");
  });

  it("still handles data URLs the agent sends directly", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const parsed = parseAgentReply(`![x](${dataUrl})`, undefined, IMAGES);
    expect(parsed.images).toEqual([dataUrl]);
  });

  it("does not duplicate an image that is both markdown and prose", () => {
    const parsed = parseAgentReply(
      `![render](${CACHED}) saved at ${CACHED}`,
      undefined,
      IMAGES,
    );
    expect(parsed.images).toEqual([`${IMAGES}/gen_1234.png`]);
  });

  it("rewrites paths nested in structured content parts", () => {
    const parsed = parseAgentReply(
      [{ type: "text", text: `Done: ![r](${CACHED})` }],
      undefined,
      IMAGES,
    );
    expect(parsed.images).toEqual([`${IMAGES}/gen_1234.png`]);
  });

  it("behaves like the plain parser when no base is known", () => {
    const parsed = parseAgentReply(`Saved to ${CACHED}`, undefined, undefined);
    expect(parsed.images).toEqual([]);
    expect(parsed.text).toContain(CACHED);
  });
});
