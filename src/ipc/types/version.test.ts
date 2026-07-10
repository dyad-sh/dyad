import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  DEFAULT_VERSION_PAGE_SIZE,
  MAX_VERSION_PAGE_SIZE,
  SetVersionFavoriteParamsSchema,
  SetVersionNoteParamsSchema,
  versionContracts,
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

  it("reject abbreviated commit hashes for version metadata", () => {
    expect(
      SetVersionFavoriteParamsSchema.safeParse({
        appId: 1,
        versionId: "abcd",
        isFavorite: true,
      }).success,
    ).toBe(false);
    expect(
      SetVersionNoteParamsSchema.safeParse({
        appId: 1,
        versionId: "abcd",
        note: "release candidate",
      }).success,
    ).toBe(false);
  });
});

describe("version IPC limits", () => {
  it("defaults to DEFAULT_VERSION_PAGE_SIZE when limit is omitted", () => {
    expect(
      versionContracts.listVersions.input.parse({ appId: 1 }),
    ).toMatchObject({ limit: DEFAULT_VERSION_PAGE_SIZE });
  });

  it("rejects version pages above the hard cap", () => {
    expect(() =>
      versionContracts.listVersions.input.parse({
        appId: 1,
        limit: MAX_VERSION_PAGE_SIZE + 1,
      }),
    ).toThrow(ZodError);
  });
});
