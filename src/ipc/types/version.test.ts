import { describe, expect, it } from "vitest";
import {
  SetVersionFavoriteParamsSchema,
  SetVersionNoteParamsSchema,
} from "./version";

describe("version metadata schemas", () => {
  it("accept 64-character SHA-256 commit hashes", () => {
    const sha256 = "a".repeat(64);

    expect(
      SetVersionFavoriteParamsSchema.safeParse({
        appId: 1,
        versionId: sha256,
        isFavorite: true,
      }).success,
    ).toBe(true);
    expect(
      SetVersionNoteParamsSchema.safeParse({
        appId: 1,
        versionId: sha256,
        note: "release candidate",
      }).success,
    ).toBe(true);
  });
});
