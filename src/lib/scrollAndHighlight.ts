export function scrollAndHighlightElement(
  element: HTMLElement,
  options: {
    behavior?: ScrollBehavior;
    block?: ScrollLogicalPosition;
    inline?: ScrollLogicalPosition;
    highlight?: boolean;
  } = {},
): void {
  element.scrollIntoView({
    behavior: options.behavior ?? "smooth",
    block: options.block ?? "start",
    inline: options.inline,
  });

  if (!options.highlight) return;

  element.classList.remove("settings-highlight");
  void element.offsetWidth;
  element.classList.add("settings-highlight");
  const removeHighlight = () => {
    element.classList.remove("settings-highlight");
  };
  element.addEventListener("animationend", removeHighlight, { once: true });
  element.addEventListener("animationcancel", removeHighlight, { once: true });
}
