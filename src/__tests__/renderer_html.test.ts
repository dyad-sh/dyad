import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("renderer HTML", () => {
  it("prevents external translators from mutating React-owned DOM", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(html).toMatch(/<html\s+class="notranslate"\s+translate="no">/);
    expect(html).toContain('<meta name="google" content="notranslate" />');
  });
});
