import { describe, expect, it } from "vitest";
import { limitChatHistoryRows } from "./history_limit";

type Row = {
  id: number;
  role: "user" | "assistant";
  isCompactionSummary: boolean | null;
};

const row = (
  id: number,
  role: Row["role"],
  isCompactionSummary: boolean | null = null,
): Row => ({ id, role, isCompactionSummary });

describe("limitChatHistoryRows", () => {
  it("retains only the configured number of user-started turns", () => {
    const rows = [
      row(1, "user"),
      row(2, "assistant"),
      row(3, "user"),
      row(4, "assistant"),
      row(5, "user"),
      row(6, "assistant"),
    ];

    expect(limitChatHistoryRows(rows, 2).map(({ id }) => id)).toEqual([
      3, 4, 5, 6,
    ]);
  });

  it("retains the latest compaction summary before the turn boundary", () => {
    const rows = [
      row(1, "assistant", true),
      row(2, "user"),
      row(3, "assistant"),
      row(4, "user"),
      row(5, "assistant"),
    ];

    expect(limitChatHistoryRows(rows, 1).map(({ id }) => id)).toEqual([
      1, 4, 5,
    ]);
  });

  it("leaves shorter histories unchanged", () => {
    const rows = [row(1, "user"), row(2, "assistant")];

    expect(limitChatHistoryRows(rows, 3)).toEqual(rows);
  });
});
