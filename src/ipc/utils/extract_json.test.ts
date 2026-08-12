import { describe, expect, it } from "vitest";

import {
  extractJson,
  extractJsonWithScan,
  SCAN_BUDGET_FACTOR,
} from "./extract_json";

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
    // Asserted on the work itself, not on a clock. Linearity here is an
    // algorithmic property — the scan budget is a multiple of the input length
    // and `opensJsonObject` rejects prose braces in O(1) — so the scan counters
    // decide it outright. A millisecond bound would instead report the CI
    // runner's load, and flake under contention on an implementation that is
    // provably fine.
    const withBraces = (repeats: number) =>
      `${"{tok} ".repeat(repeats)}result: {"ok":true}`;

    const base = extractJsonWithScan(withBraces(50_000));
    const quadrupled = extractJsonWithScan(withBraces(200_000));

    expect(JSON.parse(base.json!)).toEqual({ ok: true });
    expect(JSON.parse(quadrupled.json!)).toEqual({ ok: true });
    // Every `{tok}` is rejected on its second character, so quadrupling the
    // prose buys no extra balanced scan and no extra scanned character. Under
    // the old fallback both would have grown with the input.
    expect(base.candidateScans).toBe(1);
    expect(quadrupled.candidateScans).toBe(1);
    expect(quadrupled.scannedChars).toBe(base.scannedChars);
  });

  it("charges each scanned candidate against the budget", () => {
    // The counters are only worth asserting on if they move when real work
    // happens: two objects that open like JSON but don't parse, then one that
    // does.
    const scan = extractJsonWithScan(
      'a {"x": } b {"y": } c {"ok":true} {"trailing":1}',
    );
    expect(JSON.parse(scan.json!)).toEqual({ ok: true });
    expect(scan.candidateScans).toBe(3);
    expect(scan.scannedChars).toBeGreaterThan(0);
  });

  // The budget is a ceiling, not a stopping condition checked after the fact:
  // a candidate scanned in full before being charged could run a whole extra
  // pass over the text past an almost-exhausted budget.
  it("never scans past the advertised budget", () => {
    // Every `{"` opens a candidate that never closes, so each one costs a full
    // scan to end-of-text — the worst case the factor exists to bound.
    const adversarial = `${'{"'.repeat(20_000)}`;
    const scan = extractJsonWithScan(adversarial);

    expect(scan.scannedChars).toBeLessThanOrEqual(
      adversarial.length * SCAN_BUDGET_FACTOR,
    );
  });

  it("returns the widest span when nothing parses, so the caller reports the syntax error", () => {
    expect(extractJson("prefix {not json at all} suffix")).toBe(
      "{not json at all}",
    );
  });
});
