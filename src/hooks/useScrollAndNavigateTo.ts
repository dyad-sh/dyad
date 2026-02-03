import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { activeSettingsSectionAtom } from "@/atoms/viewAtoms";

type ScrollOptions = {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
  onScrolled?: (id: string, element: HTMLElement) => void;
  highlight?: boolean;
};

/**
 * Returns an async function that navigates to the given route, then scrolls the element with the provided id into view.
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

        if (options?.highlight) {
          element.classList.add("settings-highlight");
          const onEnd = () => {
            element.classList.remove("settings-highlight");
            element.removeEventListener("animationend", onEnd);
          };
          element.addEventListener("animationend", onEnd);
        }

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
      options?.highlight,
      setActiveSection,
    ],
  );
}
