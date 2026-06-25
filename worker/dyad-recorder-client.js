(() => {
  // Records user actions in the preview so the AI can turn them into a
  // Playwright test. Unlike the component selector, this NEVER preventDefaults
  // — the user is really using their app; we only observe and report actions
  // to the parent via postMessage. Assertions are added later by the AI.

  let active = false;

  /* ---------- selector-hint extraction ---------------------------------- */

  // Roughly map a DOM element to an ARIA role so the AI can prefer getByRole.
  function inferRole(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "a":
        return el.hasAttribute("href") ? "link" : undefined;
      case "button":
        return "button";
      case "select":
        return "combobox";
      case "textarea":
        return "textbox";
      case "input": {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "button" || type === "submit" || type === "reset")
          return "button";
        if (type === "range") return "slider";
        if (["text", "email", "search", "tel", "url", "password"].includes(type))
          return "textbox";
        return undefined;
      }
      default:
        return undefined;
    }
  }

  // Best-effort accessible name: aria-label, associated <label>, or text.
  function accessibleName(el) {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const ref = el.ownerDocument.getElementById(labelledby.split(/\s+/)[0]);
      if (ref && ref.textContent && ref.textContent.trim()) {
        return ref.textContent.trim();
      }
    }

    // <label for> or wrapping <label> for form controls.
    if (typeof el.labels !== "undefined" && el.labels && el.labels.length) {
      const text = el.labels[0].textContent;
      if (text && text.trim()) return text.trim();
    }

    return undefined;
  }

  function visibleText(el) {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 80) return undefined;
    return text;
  }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return undefined;
    const selector = {};
    const role = inferRole(el);
    if (role) selector.role = role;
    const name = accessibleName(el);
    if (name) selector.name = name;
    const placeholder = el.getAttribute && el.getAttribute("placeholder");
    if (placeholder && placeholder.trim()) selector.placeholder = placeholder.trim();
    const testId = el.getAttribute && el.getAttribute("data-testid");
    if (testId) selector.testId = testId;
    // App DOM is tagged by Dyad's babel plugin — useful fallback context.
    if (el.dataset) {
      if (el.dataset.dyadId) selector.dyadId = el.dataset.dyadId;
      if (el.dataset.dyadName) selector.dyadName = el.dataset.dyadName;
    }
    // Only attach text when it isn't already the accessible name, to avoid
    // redundant hints.
    const text = visibleText(el);
    if (text && text !== selector.name) selector.text = text;
    selector.tag = el.tagName.toLowerCase();
    return selector;
  }

  /* ---------- reporting -------------------------------------------------- */

  function report(action) {
    try {
      window.parent.postMessage(
        {
          type: "dyad-recorded-action",
          action: { ...action, timestamp: Date.now() },
        },
        "*",
      );
    } catch {
      // Ignore — recording is best-effort and must never break the app.
    }
  }

  // Walk up from the event target to the nearest meaningful interactive
  // element so a click on an icon inside a button records the button.
  function interactiveTarget(start) {
    let el = start;
    while (el && el.nodeType === 1) {
      const tag = el.tagName.toLowerCase();
      if (
        tag === "button" ||
        tag === "a" ||
        tag === "select" ||
        tag === "textarea" ||
        tag === "input" ||
        tag === "label" ||
        el.getAttribute("role") ||
        el.tabIndex >= 0 ||
        el.dataset?.dyadId
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return start;
  }

  /* ---------- event handlers -------------------------------------------- */

  function onClick(e) {
    if (!active) return;
    const el = interactiveTarget(e.target);
    if (!el) return;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute && el.getAttribute("type")) || "";
    // Checkboxes/radios are recorded on "change" as a check, not a raw click,
    // so we don't double-record them here.
    if (tag === "input" && (type === "checkbox" || type === "radio")) return;
    report({ kind: "click", selector: buildSelector(el) });
  }

  function onChange(e) {
    if (!active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "text").toLowerCase();

    if (tag === "select") {
      report({ kind: "select", selector: buildSelector(el), value: el.value });
      return;
    }
    if (tag === "input" && (type === "checkbox" || type === "radio")) {
      report({
        kind: "check",
        selector: buildSelector(el),
        value: String(!!el.checked),
      });
      return;
    }
    if (tag === "input" || tag === "textarea") {
      // Don't capture secrets verbatim — note that a value was typed instead.
      const value = type === "password" ? "********" : el.value;
      report({ kind: "fill", selector: buildSelector(el), value });
    }
  }

  function onKeyDown(e) {
    if (!active) return;
    if (e.key !== "Enter") return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") {
      report({ kind: "press", selector: buildSelector(el), value: "Enter" });
    }
  }

  /* ---------- activation / message bridge ------------------------------- */

  function activate() {
    if (active) return;
    active = true;
    window.addEventListener("click", onClick, true);
    window.addEventListener("change", onChange, true);
    window.addEventListener("keydown", onKeyDown, true);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("change", onChange, true);
    window.removeEventListener("keydown", onKeyDown, true);
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    if (e.data?.type === "activate-dyad-recorder") activate();
    if (e.data?.type === "deactivate-dyad-recorder") deactivate();
  });
})();
