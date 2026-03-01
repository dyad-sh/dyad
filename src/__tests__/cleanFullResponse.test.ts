import { cleanFullResponse } from "@/ipc/utils/cleanFullResponse";
import { describe, it, expect } from "vitest";

describe("cleanFullResponse", () => {
  it("should replace < characters in coney-write attributes", () => {
    const input = `<coney-write path="src/file.tsx" description="Testing <a> tags.">content</coney-write>`;
    const expected = `<coney-write path="src/file.tsx" description="Testing ＜a＞ tags.">content</coney-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should replace < characters in multiple attributes", () => {
    const input = `<coney-write path="src/<component>.tsx" description="Testing <div> tags.">content</coney-write>`;
    const expected = `<coney-write path="src/＜component＞.tsx" description="Testing ＜div＞ tags.">content</coney-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle multiple nested HTML tags in a single attribute", () => {
    const input = `<coney-write path="src/file.tsx" description="Testing <div> and <span> and <a> tags.">content</coney-write>`;
    const expected = `<coney-write path="src/file.tsx" description="Testing ＜div＞ and ＜span＞ and ＜a＞ tags.">content</coney-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle complex example with mixed content", () => {
    const input = `
      BEFORE TAG
  <coney-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use <a> tags.">
import React from 'react';
</coney-write>
AFTER TAG
    `;

    const expected = `
      BEFORE TAG
  <coney-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use ＜a＞ tags.">
import React from 'react';
</coney-write>
AFTER TAG
    `;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle other coney tag types", () => {
    const input = `<coney-rename from="src/<old>.tsx" to="src/<new>.tsx"></coney-rename>`;
    const expected = `<coney-rename from="src/＜old＞.tsx" to="src/＜new＞.tsx"></coney-rename>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle coney-delete tags", () => {
    const input = `<coney-delete path="src/<component>.tsx"></coney-delete>`;
    const expected = `<coney-delete path="src/＜component＞.tsx"></coney-delete>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should not affect content outside coney tags", () => {
    const input = `Some text with <regular> HTML tags. <coney-write path="test.tsx" description="With <nested> tags.">content</coney-write> More <html> here.`;
    const expected = `Some text with <regular> HTML tags. <coney-write path="test.tsx" description="With ＜nested＞ tags.">content</coney-write> More <html> here.`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle empty attributes", () => {
    const input = `<coney-write path="src/file.tsx">content</coney-write>`;
    const expected = `<coney-write path="src/file.tsx">content</coney-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle attributes without < characters", () => {
    const input = `<coney-write path="src/file.tsx" description="Normal description">content</coney-write>`;
    const expected = `<coney-write path="src/file.tsx" description="Normal description">content</coney-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });
});
