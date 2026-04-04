/**
 * joy_assistant_actions — Renderer-side DOM action executor.
 *
 * Two modes:
 *   executeAction() — actually performs the action (do-it-for-me)
 *   guideAction()   — highlights the element + shows a tooltip (guide-me)
 *
 * All DOM element lookups use `[data-joy-assist="<id>"]` only.
 */

import type { AssistantAction } from "@/types/joy_assistant_types";

// ── Helpers ────────────────────────────────────────────────────────────────

function findElement(id: string): HTMLElement | null {
  // Sanitize to prevent selector injection
  const safeId = CSS.escape(id);
  return document.querySelector<HTMLElement>(`[data-joy-assist="${safeId}"]`);
}

function scrollIntoView(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ── Guide-mode: highlight + tooltip ────────────────────────────────────────

const HIGHLIGHT_CLASS = "joy-assist-highlight";
const TOOLTIP_CLASS = "joy-assist-tooltip";

function clearGuides() {
  document
    .querySelectorAll(`.${HIGHLIGHT_CLASS}`)
    .forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
  document
    .querySelectorAll(`.${TOOLTIP_CLASS}`)
    .forEach((el) => el.remove());
}

function showHighlight(el: HTMLElement, message?: string) {
  clearGuides();
  el.classList.add(HIGHLIGHT_CLASS);
  scrollIntoView(el);

  if (message) {
    const tip = document.createElement("div");
    tip.className = TOOLTIP_CLASS;
    tip.textContent = message;
    el.style.position = el.style.position || "relative";
    el.appendChild(tip);
    // Auto-remove after 6 seconds
    setTimeout(() => {
      tip.remove();
      el.classList.remove(HIGHLIGHT_CLASS);
    }, 6000);
  }
}

// ── Execute action ─────────────────────────────────────────────────────────

export type NavigateFn = (opts: { to: string }) => void;

export interface ActionContext {
  navigate: NavigateFn;
}

export function executeAction(
  action: AssistantAction,
  ctx: ActionContext,
): { success: boolean; message?: string } {
  switch (action.type) {
    case "navigate": {
      ctx.navigate({ to: action.route });
      return { success: true };
    }

    case "fill": {
      const el = findElement(action.fieldId);
      if (!el) return { success: false, message: `Element "${action.fieldId}" not found` };
      scrollIntoView(el);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        // Use native setter so React picks up the change
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype,
          "value",
        )?.set;
        nativeInputValueSetter?.call(el, action.value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }
      if (el.isContentEditable) {
        el.textContent = action.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return { success: true };
      }
      return { success: false, message: `Element "${action.fieldId}" is not editable` };
    }

    case "click": {
      const el = findElement(action.targetId);
      if (!el) return { success: false, message: `Element "${action.targetId}" not found` };
      scrollIntoView(el);
      el.click();
      return { success: true };
    }

    case "highlight": {
      const el = findElement(action.targetId);
      if (!el) return { success: false, message: `Element "${action.targetId}" not found` };
      showHighlight(el, action.tooltip ?? action.label);
      return { success: true };
    }

    case "tooltip": {
      const el = findElement(action.targetId);
      if (!el) return { success: false, message: `Element "${action.targetId}" not found` };
      showHighlight(el, action.content);
      return { success: true };
    }

    case "create-document": {
      // Navigate to documents page; actual creation is handled by the AI
      ctx.navigate({ to: "/documents" });
      return { success: true, message: `Creating "${action.name}" document` };
    }

    case "search": {
      // Focus the global search input if one exists
      const searchEl =
        findElement("global-search") ??
        document.querySelector<HTMLInputElement>(
          'input[type="search"], input[placeholder*="earch"]',
        );
      if (searchEl && (searchEl instanceof HTMLInputElement)) {
        searchEl.focus();
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        nativeInputValueSetter?.call(searchEl, action.query);
        searchEl.dispatchEvent(new Event("input", { bubbles: true }));
        searchEl.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }
      return { success: false, message: "No search input found" };
    }

    case "open-dialog": {
      const trigger = findElement(action.dialogId);
      if (!trigger) return { success: false, message: `Dialog trigger "${action.dialogId}" not found` };
      trigger.click();
      return { success: true };
    }

    default:
      return { success: false, message: `Unknown action type` };
  }
}

// ── Guide action (highlight-only) ──────────────────────────────────────────

export function guideAction(
  action: AssistantAction,
  ctx: ActionContext,
): { success: boolean; message?: string } {
  switch (action.type) {
    case "navigate": {
      // In guide mode, just highlight the sidebar link if present
      const link = findElement(`nav-${action.route.replace(/\//g, "").replace(/ /g, "-")}`);
      if (link) {
        showHighlight(link, `Click here to navigate to ${action.route}`);
        return { success: true };
      }
      // Fallback: just describe
      return { success: true, message: `Navigate to ${action.route}` };
    }

    case "fill": {
      const el = findElement(action.fieldId);
      if (!el) return { success: false, message: `Element "${action.fieldId}" not found` };
      showHighlight(el, `Type: "${action.value}"`);
      return { success: true };
    }

    case "click": {
      const el = findElement(action.targetId);
      if (!el) return { success: false, message: `Element "${action.targetId}" not found` };
      showHighlight(el, "Click this button");
      return { success: true };
    }

    case "highlight": {
      const el = findElement(action.targetId);
      if (!el) return { success: false, message: `Element "${action.targetId}" not found` };
      showHighlight(el, action.tooltip ?? action.label);
      return { success: true };
    }

    case "tooltip": {
      const el = findElement(action.targetId);
      if (!el) return { success: false, message: `Element "${action.targetId}" not found` };
      showHighlight(el, action.content);
      return { success: true };
    }

    case "create-document":
      return { success: true, message: `Go to Documents page and create "${action.name}"` };

    case "search": {
      const searchEl = findElement("global-search");
      if (searchEl) {
        showHighlight(searchEl, `Search for: "${action.query}"`);
        return { success: true };
      }
      return { success: true, message: `Search for: "${action.query}"` };
    }

    case "open-dialog": {
      const trigger = findElement(action.dialogId);
      if (trigger) {
        showHighlight(trigger, "Click here to open");
        return { success: true };
      }
      return { success: true, message: `Open the ${action.dialogId} dialog` };
    }

    default:
      return { success: false, message: "Unknown action type" };
  }
}

export { clearGuides };
