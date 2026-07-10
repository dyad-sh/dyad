export const OPENROUTER_APP_REFERER = "https://www.dyad.sh";
export const OPENROUTER_APP_TITLE = "Dyad";
export const OPENROUTER_APP_CATEGORIES = "native-app-builder,programming-app";

export function getOpenRouterAppAttributionHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": OPENROUTER_APP_REFERER,
    "X-OpenRouter-Title": OPENROUTER_APP_TITLE,
    "X-OpenRouter-Categories": OPENROUTER_APP_CATEGORIES,
  };
}
