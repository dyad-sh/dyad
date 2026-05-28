import { describe, expect, it } from "vitest";
import { buildCollectionNameByAppId } from "./appCollections";

describe("buildCollectionNameByAppId", () => {
  it("maps app ids to collection names", () => {
    const result = buildCollectionNameByAppId([
      { id: 1, name: "Work", appIds: [10, 11] },
      { id: 2, name: "Personal", appIds: [12] },
    ]);

    expect(result.get(10)).toBe("Work");
    expect(result.get(11)).toBe("Work");
    expect(result.get(12)).toBe("Personal");
  });

  it("excludes the current collection when requested", () => {
    const result = buildCollectionNameByAppId(
      [
        { id: 1, name: "Current", appIds: [10] },
        { id: 2, name: "Other", appIds: [11] },
      ],
      1,
    );

    expect(result.has(10)).toBe(false);
    expect(result.get(11)).toBe("Other");
  });
});
