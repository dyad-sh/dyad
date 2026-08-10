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

  it("stays linear when the prose is full of non-JSON braces", () => {
    // The fallback used to scan to end-of-text from every `{`, so prose with
    // thousands of braces made this O(n^2) on the main process. Only a `{`
    // followed by `"` or `}` can open a JSON object, so the rest cost O(1).
    //
    // Asserted as a GROWTH RATE rather than a wall-clock bound. What the
    // implementation actually guarantees is algorithmic (the scan budget is a
    // multiple of the input length), and a fixed millisecond ceiling measures
    // the CI runner's current load instead — the kind of assertion that either
    // flakes or gets ignored when it fires. Quadratic work grows ~16x when the
    // input quadruples; linear work grows ~4x. The 8x threshold sits far from
    // both, so scheduler noise can't reach it.
    const withBraces = (repeats: number) =>
      `${"{tok} ".repeat(repeats)}result: {"ok":true}`;
    // Best-of-three: a single sample can be interrupted, and an interrupted
    // *baseline* is what would make a linear implementation look quadratic.
    const timeExtract = (text: string) => {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        expect(JSON.parse(extractJson(text)!)).toEqual({ ok: true });
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };

    const base = timeExtract(withBraces(50_000));
    const quadrupled = timeExtract(withBraces(200_000));
    // Guards against dividing by a zero-ish baseline on a fast machine, where
    // the ratio stops meaning anything.
    expect(quadrupled).toBeLessThan(Math.max(base, 1) * 8);
  });

  it("returns the widest span when nothing parses, so the caller reports the syntax error", () => {
    expect(extractJson("prefix {not json at all} suffix")).toBe(
      "{not json at all}",
    );
  });
});
