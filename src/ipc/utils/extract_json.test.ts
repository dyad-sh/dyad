import { describe, expect, it } from "vitest";

import { extractJson } from "./extract_json";

describe("extractJson", () => {
  it("returns the object as-is", () => {
    expect(extractJson(`{"a":1}`)).toBe(`{"a":1}`);
  });

  it("strips a markdown fence and surrounding prose", () => {
    const text = 'Sure!\n```json\n{"assertions": []}\n```\nHope that helps.';
    expect(JSON.parse(extractJson(text)!)).toEqual({ assertions: [] });
  });

  it("finds the object when the prose around it also contains braces", () => {
    // The widest `{`-to-`}` span here is garbage; the real object is the second
    // brace run. Falling over would reject a perfectly good model response.
    const text =
      'Use `{foo}` for the id; here is the result: {"assertions":[]}';
    expect(JSON.parse(extractJson(text)!)).toEqual({ assertions: [] });
  });

  it("keeps braces that live inside string values", () => {
    const text = 'result: {"code":"expect(x).toBe({a:1})","ok":true} — done';
    expect(JSON.parse(extractJson(text)!)).toEqual({
      code: "expect(x).toBe({a:1})",
      ok: true,
    });
  });

  it("returns null when there is no object at all", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("} {")).toBeNull();
  });

  it("returns the widest span when nothing parses, so the caller reports the syntax error", () => {
    expect(extractJson("prefix {not json at all} suffix")).toBe(
      "{not json at all}",
    );
  });
});
