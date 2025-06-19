import { cleanFullResponse } from "@/ipc/utils/cleanFullResponse";
import { describe, it, expect } from "vitest";

describe("cleanFullResponse", () => {
  it("should replace < characters in dyad-write attributes", () => {
    const input = `<dyad-write path="src/file.tsx" description="Testing <a> tags.">content</dyad-write>`;
    const expected = `<dyad-write path="src/file.tsx" description="Testing ＜a＞ tags.">content</dyad-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should replace < characters in multiple attributes", () => {
    const input = `<dyad-write path="src/<component>.tsx" description="Testing <div> tags.">content</dyad-write>`;
    const expected = `<dyad-write path="src/＜component＞.tsx" description="Testing ＜div＞ tags.">content</dyad-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle multiple nested HTML tags in a single attribute", () => {
    const input = `<dyad-write path="src/file.tsx" description="Testing <div> and <span> and <a> tags.">content</dyad-write>`;
    const expected = `<dyad-write path="src/file.tsx" description="Testing ＜div＞ and ＜span＞ and ＜a＞ tags.">content</dyad-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle complex example with mixed content", () => {
    const input = `
      BEFORE TAG
  <dyad-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use <a> tags.">
import React from 'react';
</dyad-write>
AFTER TAG
    `;

    const expected = `
      BEFORE TAG
  <dyad-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use ＜a＞ tags.">
import React from 'react';
</dyad-write>
AFTER TAG
    `;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle other dyad tag types", () => {
    const input = `<dyad-rename from="src/<old>.tsx" to="src/<new>.tsx"></dyad-rename>`;
    const expected = `<dyad-rename from="src/＜old＞.tsx" to="src/＜new＞.tsx"></dyad-rename>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle dyad-delete tags", () => {
    const input = `<dyad-delete path="src/<component>.tsx"></dyad-delete>`;
    const expected = `<dyad-delete path="src/＜component＞.tsx"></dyad-delete>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should not affect content outside dyad tags", () => {
    const input = `Some text with <regular> HTML tags. <dyad-write path="test.tsx" description="With <nested> tags.">content</dyad-write> More <html> here.`;
    const expected = `Some text with <regular> HTML tags. <dyad-write path="test.tsx" description="With ＜nested＞ tags.">content</dyad-write> More <html> here.`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle empty attributes", () => {
    const input = `<dyad-write path="src/file.tsx">content</dyad-write>`;
    const expected = `<dyad-write path="src/file.tsx">content</dyad-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle attributes without < characters", () => {
    const input = `<dyad-write path="src/file.tsx" description="Normal description">content</dyad-write>`;
    const expected = `<dyad-write path="src/file.tsx" description="Normal description">content</dyad-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });
});
