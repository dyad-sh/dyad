import { cleanFullResponse } from "@/ipc/utils/cleanFullResponse";
import { describe, it, expect } from "vitest";

describe("cleanFullResponse", () => {
  it("should replace < characters in joy-write attributes", () => {
    const input = `<joy-write path="src/file.tsx" description="Testing <a> tags.">content</joy-write>`;
    const expected = `<joy-write path="src/file.tsx" description="Testing ＜a＞ tags.">content</joy-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should replace < characters in multiple attributes", () => {
    const input = `<joy-write path="src/<component>.tsx" description="Testing <div> tags.">content</joy-write>`;
    const expected = `<joy-write path="src/＜component＞.tsx" description="Testing ＜div＞ tags.">content</joy-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle multiple nested HTML tags in a single attribute", () => {
    const input = `<joy-write path="src/file.tsx" description="Testing <div> and <span> and <a> tags.">content</joy-write>`;
    const expected = `<joy-write path="src/file.tsx" description="Testing ＜div＞ and ＜span＞ and ＜a＞ tags.">content</joy-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle complex example with mixed content", () => {
    const input = `
      BEFORE TAG
  <joy-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use <a> tags.">
import React from 'react';
</joy-write>
AFTER TAG
    `;

    const expected = `
      BEFORE TAG
  <joy-write path="src/pages/locations/neighborhoods/louisville/Highlands.tsx" description="Updating Highlands neighborhood page to use ＜a＞ tags.">
import React from 'react';
</joy-write>
AFTER TAG
    `;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle other joy tag types", () => {
    const input = `<joy-rename from="src/<old>.tsx" to="src/<new>.tsx"></joy-rename>`;
    const expected = `<joy-rename from="src/＜old＞.tsx" to="src/＜new＞.tsx"></joy-rename>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle joy-delete tags", () => {
    const input = `<joy-delete path="src/<component>.tsx"></joy-delete>`;
    const expected = `<joy-delete path="src/＜component＞.tsx"></joy-delete>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should not affect content outside joy tags", () => {
    const input = `Some text with <regular> HTML tags. <joy-write path="test.tsx" description="With <nested> tags.">content</joy-write> More <html> here.`;
    const expected = `Some text with <regular> HTML tags. <joy-write path="test.tsx" description="With ＜nested＞ tags.">content</joy-write> More <html> here.`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle empty attributes", () => {
    const input = `<joy-write path="src/file.tsx">content</joy-write>`;
    const expected = `<joy-write path="src/file.tsx">content</joy-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });

  it("should handle attributes without < characters", () => {
    const input = `<joy-write path="src/file.tsx" description="Normal description">content</joy-write>`;
    const expected = `<joy-write path="src/file.tsx" description="Normal description">content</joy-write>`;

    const result = cleanFullResponse(input);
    expect(result).toBe(expected);
  });
});
