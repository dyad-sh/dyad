export type SearchReplaceBlock = {
  searchContent: string;
  replaceContent: string;
};

const BLOCK_REGEX =
  /(?:^|\n)<<<<<<<\s+SEARCH>?\s*\n([\s\S]*?)(?:\n)?(?:(?<=\n)(?<!\\)=======\s*\n)([\s\S]*?)(?:\n)?(?:(?<=\n)(?<!\\)>>>>>>>\s+REPLACE)(?=\n|$)/g;

export function parseSearchReplaceBlocks(
  diffContent: string,
): SearchReplaceBlock[] {
  const matches = [...diffContent.matchAll(BLOCK_REGEX)];
  return matches.map((m) => ({
    searchContent: m[1] ?? "",
    replaceContent: m[2] ?? "",
  }));
}
