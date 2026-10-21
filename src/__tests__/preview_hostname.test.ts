import { expect, it } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  getAppPreviewHostname,
  isAppPreviewHostname,
  isPreviewNamespacedCookie,
} from "../../shared/preview_hostname";

it("uses the full immutable numeric identity even when app IDs share preferred ports", () => {
  expect(getAppPreviewHostname(42)).toBe("app-42.localhost");
  expect(getAppPreviewHostname(1000042)).toBe("app-1000042.localhost");
  expect(
    isAppPreviewHostname(getAppPreviewHostname(Number.MAX_SAFE_INTEGER)),
  ).toBe(true);
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN])(
  "rejects an invalid app ID %s",
  (id) => {
    expect(() => getAppPreviewHostname(id)).toThrow(
      new DyadError(
        "Preview app ID must be a positive safe integer",
        DyadErrorKind.Validation,
      ),
    );
  },
);

it.each([
  "app-042.localhost",
  "app-42.localhost.evil",
  "app-42.localhost.",
  "nested.app-42.localhost",
  "app-9007199254740992.localhost",
])("rejects deceptive or ambiguous hostname %s", (hostname) => {
  expect(isAppPreviewHostname(hostname)).toBe(false);
});

it.each([
  ["dyad-a12.sid", true],
  ["__Host-dyad-a12.sid", true],
  ["__Secure-dyad-a12.sid", true],
  ["__Http-dyad-a12.sid", true],
  ["__Host-Http-dyad-a12.sid", true],
  ["__host-dyad-a12.sid", true],
  ["__Host-dyad-a012.sid", false],
  [`dyad-a${Number.MAX_SAFE_INTEGER}.sid`, true],
  ["dyad-a9007199254740992.sid", false],
  ["dyad-a012.sid", false],
  ["dyad-a12sid", false],
  ["sid", false],
])("recognizes namespaced cookie %s: %s", (name, expected) => {
  expect(isPreviewNamespacedCookie(name)).toBe(expected);
});
