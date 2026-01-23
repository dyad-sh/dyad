export function cleanFullResponse(text: string): string {
  // Replace < characters inside dyad-* attributes with fullwidth less-than sign ＜
  // This prevents parsing issues when attributes contain HTML tags like <a> or <div>
  return text.replace(/<dyad-[^<>]*(?:"[^"]*"[^<>]*)*>/g, (match: string) => {
    // Find all attribute values (content within quotes) and replace < with ＜ and > with ＞
    const processedMatch = match.replace(
      /="([^"]*)"/g,
      (attrMatch: string, attrValue: string) => {
        const cleanedValue = attrValue.replace(/</g, "＜").replace(/>/g, "＞");
        return `="${cleanedValue}"`;
      },
    );
    return processedMatch;
  });
}
