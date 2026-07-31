export function limitChatHistoryRows<
  T extends { id: number; role: string; isCompactionSummary: boolean | null },
>(rows: readonly T[], maxUserTurns: number): T[] {
  const userRowIndexes = rows.flatMap((row, index) =>
    row.role === "user" ? [index] : [],
  );
  const normalizedLimit = Math.max(0, Math.floor(maxUserTurns));

  if (userRowIndexes.length <= normalizedLimit) return [...rows];

  const startIndex =
    normalizedLimit === 0
      ? rows.length
      : userRowIndexes[userRowIndexes.length - normalizedLimit];
  const latestSummaryId = rows.reduce<number | undefined>(
    (latest, row) =>
      row.isCompactionSummary && (latest === undefined || row.id > latest)
        ? row.id
        : latest,
    undefined,
  );

  return rows.filter(
    (row, index) => index >= startIndex || row.id === latestSummaryId,
  );
}
