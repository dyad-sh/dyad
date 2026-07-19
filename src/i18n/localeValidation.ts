export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export function flattenResource(
  value: JsonValue,
  prefix = "",
): Record<string, string> {
  if (typeof value === "string") {
    return { [prefix]: value };
  }

  if (Array.isArray(value)) {
    return Object.fromEntries(
      value.flatMap((item, index) =>
        Object.entries(flattenResource(item, `${prefix}.${index}`)),
      ),
    );
  }

  if (value === null || typeof value !== "object") {
    return { [prefix]: String(value) };
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      Object.entries(flattenResource(child, prefix ? `${prefix}.${key}` : key)),
    ),
  );
}

export function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/{{\s*-?\s*([^}]+?)\s*}}/g)]
    .map((match) => match[1])
    .sort();
}

export function richTextTokens(value: string): string[] {
  return [...value.matchAll(/<\/?[0-9]+>/g)].map((match) => match[0]).sort();
}

export function compareResourceKeys(
  en: JsonValue,
  zhCN: JsonValue,
  namespace: string,
): string[] {
  const enKeys = Object.keys(flattenResource(en));
  const zhCNKeys = Object.keys(flattenResource(zhCN));
  const zhCNKeySet = new Set(zhCNKeys);
  const enKeySet = new Set(enKeys);

  return [
    ...enKeys
      .filter((key) => !zhCNKeySet.has(key))
      .map((key) => `${namespace}:${key} missing from zh-CN`),
    ...zhCNKeys
      .filter((key) => !enKeySet.has(key))
      .map((key) => `${namespace}:${key} is not in en`),
  ];
}

export function compareResourceTokens(
  en: JsonValue,
  zhCN: JsonValue,
  namespace: string,
): string[] {
  const enValues = flattenResource(en);
  const zhCNValues = flattenResource(zhCN);
  const differences: string[] = [];

  for (const key of Object.keys(enValues)) {
    if (!(key in zhCNValues)) continue;

    if (
      JSON.stringify(interpolationTokens(enValues[key])) !==
      JSON.stringify(interpolationTokens(zhCNValues[key]))
    ) {
      differences.push(`${namespace}:${key} interpolation`);
    }

    if (
      JSON.stringify(richTextTokens(enValues[key])) !==
      JSON.stringify(richTextTokens(zhCNValues[key]))
    ) {
      differences.push(`${namespace}:${key} rich-text`);
    }
  }

  return differences;
}

export function findPluralDifferences(
  en: JsonValue,
  zhCN: JsonValue,
  namespace: string,
): string[] {
  const enKeys = Object.keys(flattenResource(en));
  const zhCNKeys = new Set(Object.keys(flattenResource(zhCN)));

  return enKeys
    .filter((key) => key.endsWith("_one") || key.endsWith("_other"))
    .filter((key) => !zhCNKeys.has(key))
    .map((key) => `${namespace}:${key} missing plural form`);
}
