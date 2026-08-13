import type { LocatorDescriptor } from "./types";

/**
 * Whether a recorded CSS locator is coupled to the page's current DOM shape.
 *
 * A bare id or a short authored selector can be stable. Positional selectors,
 * root-anchored paths, and long direct-child chains are generated fallbacks
 * whose meaning changes when otherwise unrelated layout wrappers are edited.
 */
export function isFragileCssLocator(locator: LocatorDescriptor): boolean {
  if (locator.kind !== "css") return false;

  const selector = locator.value.trim();
  if (/:nth-(?:child|last-child|of-type|last-of-type)\s*\(/i.test(selector)) {
    return true;
  }
  if (/^(?:body|#root)\s*>/i.test(selector)) return true;

  // Four or more direct-child hops is a generated DOM path even when it found
  // an authored id somewhere above the target.
  let childCombinators = 0;
  for (let index = 0; index < selector.length; index++) {
    if (selector[index] !== ">") continue;
    let precedingBackslashes = 0;
    for (let cursor = index - 1; selector[cursor] === "\\"; cursor--) {
      precedingBackslashes++;
    }
    if (precedingBackslashes % 2 === 0) childCombinators++;
  }
  return childCombinators >= 4;
}
