import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { activeSettingsSectionAtom } from "@/atoms/viewAtoms";

/**
 * Represents the options for scrolling.
 * @interface
 */
type ScrollOptions = {
  /** The scroll behavior. */
  behavior?: ScrollBehavior;
  /** The vertical alignment of the scrolled element. */
  block?: ScrollLogicalPosition;
  /** The horizontal alignment of the scrolled element. */
  inline?: ScrollLogicalPosition;
  /** A callback to run after scrolling. */
  onScrolled?: (id: string, element: HTMLElement) => void;
};

/**
 * A hook that returns an async function that navigates to the given route, then scrolls the element with the provided id into view.
 * @param {string} [to="/settings"] - The route to navigate to.
 * @param {ScrollOptions} [options] - The options for scrolling.
 * @returns {(id: string) => Promise<boolean>} An async function that navigates and scrolls.
 */
export function useScrollAndNavigateTo(
  to: string = "/settings",
  options?: ScrollOptions,
) {
  const navigate = useNavigate();
  const setActiveSection = useSetAtom(activeSettingsSectionAtom);

  return useCallback(
    async (id: string) => {
      await navigate({ to });
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({
          behavior: options?.behavior ?? "smooth",
          block: options?.block ?? "start",
          inline: options?.inline,
        });
        setActiveSection(id);
        options?.onScrolled?.(id, element);
        return true;
      }
      return false;
    },
    [
      navigate,
      to,
      options?.behavior,
      options?.block,
      options?.inline,
      options?.onScrolled,
      setActiveSection,
    ],
  );
}
