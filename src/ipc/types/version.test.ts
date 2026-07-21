import { describe, expect, it } from "vitest";
import {
  CheckoutVersionParamsSchema,
  SetVersionFavoriteParamsSchema,
  SetVersionNoteParamsSchema,
  VersionCommandResultSchema,
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

describe("version mutation contracts", () => {
  it("requires explicit preview versus return checkout intent", () => {
    expect(
      CheckoutVersionParamsSchema.safeParse({
        purpose: "preview",
        appId: 1,
        versionId: "abc123",
      }).success,
    ).toBe(true);
    expect(
      CheckoutVersionParamsSchema.safeParse({
        purpose: "return",
        appId: 1,
        branch: "feature/live",
      }).success,
    ).toBe(true);
    expect(
      CheckoutVersionParamsSchema.safeParse({ appId: 1, versionId: "main" })
        .success,
    ).toBe(false);
  });

  it("validates the complete authoritative result envelope", () => {
    expect(
      VersionCommandResultSchema.safeParse({
        repositoryOutcome: "target-applied",
        notification: null,
        runtimeAction: "restart",
        affectedChatId: 2,
        createdChatId: null,
      }).success,
    ).toBe(true);
    expect(
      VersionCommandResultSchema.safeParse({ runtimeAction: "restart" })
        .success,
    ).toBe(false);
  });
});
