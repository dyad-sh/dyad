export interface InvalidProviderApiKeyCharacter {
  index: number;
  codePoint: number;
}

export function normalizeProviderApiKeyInput(
  value: string | null | undefined,
): string {
  return value?.trim() ?? "";
}

export function findInvalidProviderApiKeyCharacter(
  value: string,
): InvalidProviderApiKeyCharacter | null {
  let index = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint < 0x21 || codePoint > 0x7e) {
      return { index, codePoint };
    }
    index += char.length;
  }
  return null;
}

export function formatInvalidProviderApiKeyMessage(
  providerDisplayName: string,
  invalid: InvalidProviderApiKeyCharacter,
): string {
  return `${providerDisplayName} API key contains an invalid character at index ${invalid.index} (U+${invalid.codePoint.toString(16).toUpperCase().padStart(4, "0")}). Paste only the raw API key, without labels, notes, or copied page text.`;
}
