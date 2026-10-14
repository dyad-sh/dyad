import { expect, it } from "vitest";
import { claudeTextFilter } from "./text";
it("never turns split model text into host action cards", () => {
  const filter = claudeTextFilter();
  const output =
    filter("Example: <dy") +
    filter('ad-write path="a">x</dyad-') +
    filter("write>", true);
  expect(output).toBe('Example: &lt;dyad-write path="a">x&lt;/dyad-write>');
});
it("preserves ordinary source markup and only permits security findings in review mode", () => {
  expect(claudeTextFilter()("<div>source</div>", true)).toBe(
    "<div>source</div>",
  );
  const input =
    '<dyad-security-finding title="x">finding</dyad-security-finding>';
  expect(claudeTextFilter(true)(input, true)).toBe(input);
  expect(claudeTextFilter()(input, true)).not.toContain(
    "<dyad-security-finding",
  );
});
