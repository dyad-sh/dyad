export const CHAT_SCOPE_PREFIX = "chat: ";
export const COMMAND_PALETTE_OPENING_EVENT = "dyad:command-palette-opening";

export type CommandPaletteQuery =
  | { scope: "all"; term: string }
  | { scope: "chat"; term: string };

export function parseCommandPaletteQuery(query: string): CommandPaletteQuery {
  const match = query.match(/^\s*chat\s*:\s*/i);
  if (!match) {
    return { scope: "all", term: query.trim() };
  }

  return {
    scope: "chat",
    term: query.slice(match[0].length).trim(),
  };
}

export function scoreCommandPaletteItem(
  value: string,
  term: string,
  keywords: readonly string[] = [],
): number {
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) return 1;

  const normalizedValue = value.toLowerCase();
  const valueIndex = normalizedValue.indexOf(normalizedTerm);
  if (valueIndex >= 0) {
    return 100 - Math.min(valueIndex, 90);
  }

  return keywords.some((keyword) =>
    keyword.toLowerCase().includes(normalizedTerm),
  )
    ? 50
    : 0;
}

export function getCommandPaletteSnippet(
  text: string,
  query: string,
  radius = 50,
): string {
  const trimmedQuery = query.trim();
  const matchIndex = text.toLowerCase().indexOf(trimmedQuery.toLowerCase());

  if (!trimmedQuery || matchIndex === -1) {
    return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  }

  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + trimmedQuery.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function announceCommandPaletteOpening(): void {
  window.dispatchEvent(new Event(COMMAND_PALETTE_OPENING_EVENT));
}

export function hasBlockingAlertDialogOpen(
  root: Pick<Document, "querySelector"> = document,
): boolean {
  return Boolean(
    root.querySelector('[data-slot="alert-dialog-content"][data-open]'),
  );
}

export async function revealCommandPaletteTarget(
  id: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 20;
  const delayMs = options.delayMs ?? 50;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.classList.remove("settings-highlight");
      void element.offsetWidth;
      element.classList.add("settings-highlight");

      const removeHighlight = () => {
        element.classList.remove("settings-highlight");
      };
      element.addEventListener("animationend", removeHighlight, { once: true });
      element.addEventListener("animationcancel", removeHighlight, {
        once: true,
      });
      return true;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  return false;
}
