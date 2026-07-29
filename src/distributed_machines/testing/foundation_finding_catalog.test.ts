import { describe, expect, it } from "vitest";
import { FOUNDATION_FINDINGS } from "./foundation_finding_catalog";

describe("foundation finding enforcement catalog", () => {
  it("maps all 46 exact review findings once", () => {
    expect(FOUNDATION_FINDINGS).toHaveLength(46);
    expect(new Set(FOUNDATION_FINDINGS.map(({ id }) => id)).size).toBe(46);
    expect(
      FOUNDATION_FINDINGS.reduce<Record<number, number>>((counts, finding) => {
        counts[finding.pr] = (counts[finding.pr] ?? 0) + 1;
        return counts;
      }, {}),
    ).toEqual({
      4098: 1,
      4099: 4,
      4100: 14,
      4101: 4,
      4102: 5,
      4104: 6,
      4105: 10,
      4106: 2,
    });
  });

  it("deduplicates repeated comments into reusable enforcement shapes", () => {
    const scenarioCounts = FOUNDATION_FINDINGS.flatMap(({ enforcement }) =>
      enforcement.kind === "conformance-scenario" ? [enforcement.scenario] : [],
    );
    expect(new Set(scenarioCounts).size).toBeLessThan(scenarioCounts.length);
    expect(scenarioCounts).toEqual(
      expect.arrayContaining([
        "construction-disposal-recreation",
        "post-authorization-actor-window-change",
        "unsubscribe-during-bootstrap",
        "refresh-acquires-ownership",
        "unresolved-receipt-under-pressure",
        "disposal-with-unresolved-work",
      ]),
    );
  });
});
