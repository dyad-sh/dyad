import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import {
  activeSettingsSectionAtom,
  activeSettingsTabAtom,
} from "@/atoms/viewAtoms";
import { getTabIdForSection } from "@/lib/settingsTabs";

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
  const setActiveTab = useSetAtom(activeSettingsTabAtom);

  const scrollToElement = useCallback(
    (id: string, sectionId?: string) => {
      const resolvedSection = sectionId ?? id;
      if (to === "/settings") {
        setActiveTab(getTabIdForSection(resolvedSection));
      }
      setActiveSection(resolvedSection);

      const element = document.getElementById(id);
      if (!element) {
        return false;
      }

      element.scrollIntoView({
        behavior: options?.behavior ?? "smooth",
        block: options?.block ?? "start",
        inline: options?.inline,
      });
      options?.onScrolled?.(id, element);

      if (options?.highlight) {
        element.classList.remove("settings-highlight");
        void element.offsetWidth;
        element.classList.add("settings-highlight");
        const onEnd = () => {
          element.classList.remove("settings-highlight");
        };
        element.addEventListener("animationend", onEnd, { once: true });
        element.addEventListener("animationcancel", onEnd, { once: true });
      }

      return true;
    },
    // Depend on the individual option fields (stable primitives/callbacks)
    // rather than the `options` object, which callers typically pass as a
    // fresh inline object each render.
    // eslint-disable-next-line react/exhaustive-deps
    [
      to,
      options?.behavior,
      options?.block,
      options?.inline,
      options?.onScrolled,
      options?.highlight,
      setActiveSection,
      setActiveTab,
    ],
  );

  return useCallback(
    async (id: string, sectionId?: string) => {
      await navigate({ to });

      if (to === "/settings") {
        // Wait for the target tab panel to mount before scrolling.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      }

      return scrollToElement(id, sectionId);
    },
    [navigate, to, scrollToElement],
  );
}
