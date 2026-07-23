/**
 * dyad-recorder-client.js
 *
 * Injected into the preview iframe by the proxy server (see proxy_server.js).
 * Observes trusted user interactions while "recording" is active and reports a
 * normalized action stream to the Dyad renderer via postMessage. It is
 * OBSERVE-ONLY: it never calls preventDefault, so the app behaves exactly as it
 * would without the recorder. Fidelity of the recorded steps is verified later
 * by actually running the generated Playwright test.
 *
 * The action-capture semantics are a small port of Playwright's in-page
 * RecordActionTool: text entry is captured as a single `fill` with the full
 * value (never individual key presses), form-control toggles come from `change`
 * (so no capture-phase reversal is needed), plain clicks are stalled briefly so
 * a double-click can supersede them, and selectors are generated with a ranking
 * that prefers stable, human-readable locators.
 *
 * This file is plain, dependency-free IIFE JS (no imports/exports) — it is read
 * verbatim and injected into every previewed HTML document. It communicates
 * only through window.postMessage / addEventListener("message").
 *
 * Protocol:
 *   down (from parent): { type: "activate-dyad-recorder" | "deactivate-dyad-recorder" }
 *   up   (to parent):   { type: "dyad-recorder-initialized" }
 *                       { type: "dyad-recorder-action", action: RecordedAction }
 *
 * A RecordedAction is one of:
 *   { kind: "click",   locator }
 *   { kind: "dblclick",locator }
 *   { kind: "fill",    locator, value }
 *   { kind: "press",   locator, key }
 *   { kind: "check",   locator }
 *   { kind: "uncheck", locator }
 *   { kind: "select",  locator, values: string[] }
 * where `locator` is a serializable descriptor:
 *   { kind: "testid"|"role"|"placeholder"|"label"|"text"|"dyadId"|"css",
 *     value: string, name?: string, exact?: boolean, nth?: number }
 */
(() => {
  const OVERLAY_CLASS = "__dyad_recorder_overlay__";
  // Plain clicks are held this long so a following dblclick can supersede them.
  const CLICK_DEBOUNCE_MS = 200;
  // Identical actions fired within this window are collapsed. This absorbs the
  // synthetic duplicate the browser dispatches when a <label> activates its
  // control, without swallowing deliberate repeat interactions (a real double
  // single-click becomes a dblclick well before this).
  const DEDUPE_MS = 50;

  const INTERACTIVE_SELECTOR =
    "button, a, input, select, textarea, summary, " +
    '[role="button"], [role="link"], [role="checkbox"], [role="radio"], ' +
    '[role="tab"], [role="menuitem"], [role="switch"], [role="option"]';

  const NAV_KEYS = new Set([
    "Enter",
    "Escape",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ]);

  let active = false;
  let pendingClick = null;
  let lastEmit = { key: "", at: 0 };
  let hoverBox = null;

  /* ---------- small helpers -------------------------------------------- */
  const css = (el, obj) => Object.assign(el.style, obj);

  function normalize(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function cssEscape(value) {
    if (typeof window !== "undefined" && window.CSS && window.CSS.escape) {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\\]]/g, "\\$&");
  }

  function trustedOk(e) {
    return e.isTrusted || window.__DYAD_RECORDER_ALLOW_UNTRUSTED__ === true;
  }

  function deepTarget(e) {
    const path = e.composedPath && e.composedPath();
    if (path && path.length) {
      for (const node of path) {
        if (node && node.nodeType === 1) return node;
      }
    }
    return e.target;
  }

  function isOverlayEvent(e) {
    const path = (e.composedPath && e.composedPath()) || [];
    return path.some(
      (node) =>
        node && node.classList && node.classList.contains(OVERLAY_CLASS),
    );
  }

  function isCheckboxOrRadio(el) {
    if (!el || el.tagName !== "INPUT") return false;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return type === "checkbox" || type === "radio";
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return ![
        "checkbox",
        "radio",
        "button",
        "submit",
        "reset",
        "file",
        "image",
        "range",
        "color",
        "hidden",
      ].includes(type);
    }
    return el.isContentEditable === true;
  }

  /**
   * Resolve the actual control a pointer interaction concerns. Clicking a
   * <label> (or content inside it) activates its associated control, so we map
   * to that control and let the control's own `change`/`click` drive recording.
   * Returns null for elements that are not form controls.
   */
  function resolveControl(el) {
    if (!el) return null;
    const label = el.closest && el.closest("label");
    if (label) {
      if (label.control) return label.control;
      const forId = label.getAttribute("for");
      if (forId) {
        const control = document.getElementById(forId);
        if (control) return control;
      }
    }
    if (
      el.tagName === "INPUT" ||
      el.tagName === "SELECT" ||
      el.tagName === "TEXTAREA"
    ) {
      return el;
    }
    return null;
  }

  function retarget(el) {
    if (!el || el.nodeType !== 1) return el;
    const closest = el.closest && el.closest(INTERACTIVE_SELECTOR);
    return closest || el;
  }

  /* ---------- role / accessible-name (minimal port) -------------------- */
  function computeRole(el) {
    if (!el || el.nodeType !== 1) return null;
    const explicit = el.getAttribute && el.getAttribute("role");
    if (explicit && explicit.trim()) return explicit.trim().toLowerCase();
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    switch (tag) {
      case "button":
        return "button";
      case "a":
        return el.hasAttribute("href") ? "link" : null;
      case "select":
        return el.hasAttribute("multiple") ? "listbox" : "combobox";
      case "textarea":
        return "textbox";
      case "nav":
        return "navigation";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "heading";
      case "img":
        return "img";
      case "input": {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (["button", "submit", "reset", "image"].includes(type))
          return "button";
        if (type === "range") return "slider";
        if (type === "search") return "searchbox";
        if (type === "password") return null; // no matching ARIA role
        if (["text", "email", "tel", "url", "number"].includes(type))
          return "textbox";
        return "textbox";
      }
      default:
        return null;
    }
  }

  function associatedLabelText(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) {
      const l = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (l) return normalize(l.textContent);
    }
    const wrap = el.closest && el.closest("label");
    if (wrap) return normalize(wrap.textContent);
    return null;
  }

  function computeAccName(el) {
    if (!el || el.nodeType !== 1) return null;
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && aria.trim()) return normalize(aria);

    const labelledby = el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledby) {
      const parts = labelledby
        .split(/\s+/)
        .map((id) => {
          const ref = document.getElementById(id);
          return ref ? normalize(ref.textContent) : "";
        })
        .filter(Boolean);
      if (parts.length) return normalize(parts.join(" "));
    }

    const fromLabel = associatedLabelText(el);
    if (fromLabel) return fromLabel;

    if (el.tagName === "IMG") {
      const alt = el.getAttribute("alt");
      if (alt && alt.trim()) return normalize(alt);
    }

    const role = computeRole(el);
    if (
      ["button", "link", "heading", "tab", "menuitem", "option"].includes(role)
    ) {
      const text = normalize(el.textContent);
      if (text) return text;
    }

    const title = el.getAttribute && el.getAttribute("title");
    if (title && title.trim()) return normalize(title);

    return null;
  }

  function labelForGetByLabel(el) {
    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && aria.trim()) return normalize(aria);
    return associatedLabelText(el);
  }

  /* ---------- selector generation -------------------------------------- */
  function allElements() {
    return Array.prototype.slice.call(document.querySelectorAll("*"));
  }

  function hasDescendantWithText(el, value) {
    return Array.prototype.some.call(
      el.querySelectorAll("*"),
      (child) => normalize(child.textContent) === value,
    );
  }

  function queryAll(descriptor) {
    switch (descriptor.kind) {
      case "testid":
        return allElements().filter(
          (e) => e.getAttribute("data-testid") === descriptor.value,
        );
      case "role":
        return allElements().filter(
          (e) =>
            computeRole(e) === descriptor.value &&
            computeAccName(e) === descriptor.name,
        );
      case "placeholder":
        return allElements().filter(
          (e) => e.getAttribute("placeholder") === descriptor.value,
        );
      case "label":
        return allElements().filter(
          (e) => labelForGetByLabel(e) === descriptor.value,
        );
      case "text":
        return allElements().filter(
          (e) =>
            normalize(e.textContent) === descriptor.value &&
            !hasDescendantWithText(e, descriptor.value),
        );
      case "dyadId":
        return Array.prototype.slice.call(
          document.querySelectorAll(
            `[data-dyad-id="${cssEscape(descriptor.value)}"]`,
          ),
        );
      case "css":
        try {
          return Array.prototype.slice.call(
            document.querySelectorAll(descriptor.value),
          );
        } catch {
          return [];
        }
      default:
        return [];
    }
  }

  function buildCandidates(el) {
    const candidates = [];

    const testid = el.getAttribute && el.getAttribute("data-testid");
    if (testid) candidates.push({ kind: "testid", value: testid });

    const role = computeRole(el);
    const name = computeAccName(el);
    if (role && name) candidates.push({ kind: "role", value: role, name });

    const placeholder = el.getAttribute && el.getAttribute("placeholder");
    if (placeholder)
      candidates.push({ kind: "placeholder", value: placeholder });

    const label = labelForGetByLabel(el);
    if (label) candidates.push({ kind: "label", value: label });

    const text = normalize(el.textContent);
    if (text && text.length <= 40 && !isEditable(el)) {
      candidates.push({ kind: "text", value: text, exact: true });
    }

    const dyadId = el.getAttribute && el.getAttribute("data-dyad-id");
    if (dyadId) candidates.push({ kind: "dyadId", value: dyadId });

    return candidates;
  }

  function cssPathDescriptor(el) {
    if (el.id) {
      const idSel = `#${cssEscape(el.id)}`;
      try {
        if (document.querySelectorAll(idSel).length === 1) {
          return { kind: "css", value: idSel };
        }
      } catch {
        /* fall through to path building */
      }
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`#${cssEscape(node.id)}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.prototype.filter.call(
          parent.children,
          (c) => c.tagName === node.tagName,
        );
        if (sameTag.length > 1) {
          part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return { kind: "css", value: parts.join(" > ") };
  }

  /**
   * Pick the best selector descriptor for `el`: the highest-priority candidate
   * that uniquely matches it; else the highest-priority one disambiguated by an
   * nth index; else a CSS-path fallback.
   */
  function selectorFor(el) {
    const candidates = buildCandidates(el)
      .map((c) => ({ descriptor: c, matches: queryAll(c) }))
      .filter(({ matches }) => matches.includes(el));

    for (const { descriptor, matches } of candidates) {
      if (matches.length === 1) return descriptor;
    }
    for (const { descriptor, matches } of candidates) {
      if (matches.length <= 20) {
        return { ...descriptor, nth: matches.indexOf(el) };
      }
    }
    return cssPathDescriptor(el);
  }

  /* ---------- emit / dedupe -------------------------------------------- */
  function emit(action) {
    const key = JSON.stringify(action);
    const now = Date.now();
    if (key === lastEmit.key && now - lastEmit.at < DEDUPE_MS) return;
    lastEmit = { key, at: now };
    window.parent.postMessage({ type: "dyad-recorder-action", action }, "*");
  }

  function clearPendingClick() {
    if (pendingClick) {
      clearTimeout(pendingClick.timer);
      pendingClick = null;
    }
  }

  function scheduleClick(action) {
    clearPendingClick();
    pendingClick = {
      action,
      timer: setTimeout(() => {
        pendingClick = null;
        emit(action);
      }, CLICK_DEBOUNCE_MS),
    };
  }

  /* ---------- key handling --------------------------------------------- */
  function keyCombo(e) {
    const mods = [];
    if (e.ctrlKey) mods.push("Control");
    if (e.metaKey) mods.push("Meta");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    let key = e.key;
    if (key && key.length === 1) key = key.toUpperCase();
    return [...mods, key].join("+");
  }

  function shouldRecordPress(e) {
    if (["Control", "Meta", "Alt", "Shift"].includes(e.key)) return false;
    const hasNonShiftModifier = e.ctrlKey || e.metaKey || e.altKey;
    if (hasNonShiftModifier) return true;
    if (NAV_KEYS.has(e.key)) {
      // Enter inside multi-line editors inserts a newline — that is captured by
      // the resulting `fill`, so don't also record it as a press.
      if (e.key === "Enter") {
        const t = deepTarget(e);
        if (t && (t.tagName === "TEXTAREA" || t.isContentEditable))
          return false;
      }
      return true;
    }
    return false;
  }

  /* ---------- event handlers ------------------------------------------- */
  function onClick(e) {
    if (!active || !trustedOk(e) || isOverlayEvent(e)) return;
    const raw = deepTarget(e);

    const control = resolveControl(raw);
    if (control) {
      // Form-control interactions are recorded from their `change` event
      // (toggles, selects) or their own `input` (text). Skip the click so we
      // don't double-record or emit a spurious click before a fill.
      if (
        isCheckboxOrRadio(control) ||
        control.tagName === "SELECT" ||
        isEditable(control)
      ) {
        return;
      }
    }

    const target = retarget(raw);
    scheduleClick({ kind: "click", locator: selectorFor(target) });
  }

  function onDblClick(e) {
    if (!active || !trustedOk(e) || isOverlayEvent(e)) return;
    clearPendingClick();
    const target = retarget(deepTarget(e));
    emit({ kind: "dblclick", locator: selectorFor(target) });
  }

  function onInput(e) {
    if (!active || !trustedOk(e)) return;
    const t = deepTarget(e);
    if (!t || t.nodeType !== 1) return;
    if (t.tagName === "SELECT") return; // handled by `change`
    if (!isEditable(t)) return;
    const value = t.isContentEditable ? t.innerText : t.value;
    emit({
      kind: "fill",
      locator: selectorFor(t),
      value: value == null ? "" : value,
    });
  }

  function onChange(e) {
    if (!active || !trustedOk(e)) return;
    const t = deepTarget(e);
    if (!t || t.nodeType !== 1) return;

    if (t.tagName === "SELECT") {
      const values = [];
      const options = t.options || [];
      for (let i = 0; i < options.length; i++) {
        if (options[i].selected) values.push(options[i].value);
      }
      emit({ kind: "select", locator: selectorFor(t), values });
      return;
    }

    if (isCheckboxOrRadio(t)) {
      // `change` fires after the toggle, so `checked` is the final state.
      const checked = t.tagName === "INPUT" ? t.checked : false;
      emit({ kind: checked ? "check" : "uncheck", locator: selectorFor(t) });
    }
  }

  function onKeyDown(e) {
    if (!active || !trustedOk(e)) return;
    if (isOverlayEvent(e)) return;
    if (!shouldRecordPress(e)) return;
    const target = retarget(deepTarget(e));
    emit({ kind: "press", locator: selectorFor(target), key: keyCombo(e) });
  }

  /* ---------- hover highlight ------------------------------------------ */
  function ensureHoverBox() {
    if (hoverBox && hoverBox.isConnected) return hoverBox;
    hoverBox = document.createElement("div");
    hoverBox.className = OVERLAY_CLASS;
    css(hoverBox, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483647",
      border: "2px solid #e5484d",
      background: "rgba(229,72,77,0.08)",
      borderRadius: "3px",
      display: "none",
    });
    (document.body || document.documentElement).appendChild(hoverBox);
    return hoverBox;
  }

  function hideHover() {
    if (hoverBox) hoverBox.style.display = "none";
  }

  function onMouseMove(e) {
    if (!active || isOverlayEvent(e)) return;
    const raw = deepTarget(e);
    const target = resolveControl(raw) || retarget(raw);
    if (!target || target.nodeType !== 1 || !target.getBoundingClientRect) {
      hideHover();
      return;
    }
    const rect = target.getBoundingClientRect();
    const box = ensureHoverBox();
    css(box, {
      display: "block",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  /* ---------- activation ----------------------------------------------- */
  function activate() {
    if (active) return;
    active = true;
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onDblClick, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    clearPendingClick();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("dblclick", onDblClick, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("mousemove", onMouseMove, true);
    hideHover();
  }

  /* ---------- message bridge ------------------------------------------- */
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    const type = e.data && e.data.type;
    if (type === "activate-dyad-recorder") activate();
    else if (type === "deactivate-dyad-recorder") deactivate();
  });

  function init() {
    window.parent.postMessage({ type: "dyad-recorder-initialized" }, "*");
    console.debug("Dyad recorder client initialized");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
