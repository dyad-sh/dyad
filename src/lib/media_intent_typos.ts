const MEDIA_NOUN_TYPOS: Record<string, string> = {
  iage: "image",
  iamge: "image",
  imag: "image",
  imgae: "image",
  imge: "image",
  immage: "image",
  picure: "picture",
  pictue: "picture",
  piture: "picture",
  phpto: "photo",
  poto: "photo",
  animtion: "animation",
  animiation: "animation",
  vdeo: "video",
  vedio: "video",
  vide: "video",
  vido: "video",
};

const MEDIA_NOUN_TYPO_PATTERN = new RegExp(
  `\\b(?:${Object.keys(MEDIA_NOUN_TYPOS).join("|")})\\b`,
  "gi",
);

/**
 * Corrects only a short allowlist of common media-noun typos for intent
 * detection. The original message is still sent to the generator unchanged.
 */
export function normalizeMediaIntentTypos(text: string): string {
  return text.replace(MEDIA_NOUN_TYPO_PATTERN, (match) => {
    return MEDIA_NOUN_TYPOS[match.toLowerCase()] ?? match;
  });
}
