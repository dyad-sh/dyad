import { describe, expect, it } from "vitest";

import { isFragileCssLocator } from "./selector_quality";

describe("isFragileCssLocator", () => {
  it("flags positional, root-anchored, and long structural CSS", () => {
    expect(
      isFragileCssLocator({
        kind: "css",
        value: "#panel > section:nth-of-type(2) > input",
      }),
    ).toBe(true);
    expect(
      isFragileCssLocator({ kind: "css", value: "#root > main > input" }),
    ).toBe(true);
    expect(
      isFragileCssLocator({
        kind: "css",
        value: "#app > main > section > form > div > input",
      }),
    ).toBe(true);
  });

  it("leaves stable and semantic locators alone", () => {
    expect(isFragileCssLocator({ kind: "css", value: "#due-date" })).toBe(
      false,
    );
    expect(
      isFragileCssLocator({ kind: "css", value: "form > .due-date" }),
    ).toBe(false);
    expect(
      isFragileCssLocator({
        kind: "role",
        value: "button",
        name: "Save",
      }),
    ).toBe(false);
  });

  it("does not count an escaped greater-than sign as a child combinator", () => {
    expect(
      isFragileCssLocator({
        kind: "css",
        value: "#panel\\>details > section > form > input",
      }),
    ).toBe(false);
  });
});
