/**
 * dyad-recorder-client.js
 *
 * Injected into the preview iframe by the proxy server (see proxy_server.js).
 * Observes user interactions while recording is active and reports a normalized
 * action stream to the renderer via postMessage. OBSERVE-ONLY: it never calls
 * preventDefault, so the app behaves exactly as it would without the recorder.
 *
 * Capture semantics are a small port of Playwright's in-page RecordActionTool:
 * text entry becomes a single `fill` with the full value, form-control toggles
 * come from `change`, and selectors prefer stable, human-readable locators.
 * Clicks are reported immediately — a click that navigates would otherwise be
 * lost with the unloading document — and the renderer's `collapseActions` folds
 * the clicks preceding a double-click into it.
 *
 * Plain, dependency-free IIFE JS: it is read verbatim and injected into every
 * previewed HTML document. See `src/lib/test_recorder/types.ts` for the schemas
 * of the actions and locator descriptors it emits.
 *
 * Protocol:
 *   down (from parent): { type: "activate-dyad-recorder" | "deactivate-dyad-recorder" }
 *   up   (to parent):   { type: "dyad-recorder-initialized" }
 *                       { type: "dyad-recorder-action", action: RecordedAction }
 */
(() => {
  const OVERLAY_CLASS = "__dyad_recorder_overlay__";
  // Absorbs the synthetic duplicate the browser dispatches when a <label>
  // activates its control, without swallowing deliberate repeat interactions.
  const DEDUPE_MS = 50;

  // A typed password must never land in the generated spec as a plaintext
  // secret. The `fill` step is still recorded so the flow/locator is preserved.
  const PASSWORD_PLACEHOLDER = "REPLACE_WITH_PASSWORD";

  // Fields whose name says "secret" even though the type doesn't. Deliberately
  // conservative — a false positive costs one placeholder to replace, a false
  // negative writes a live credential into the user's repo.
  const SECRET_NAME_RE =
    /password|passwd|passphrase|secret|token|api[-_ ]?key|private[-_ ]?key|credential|\botp|\btotp|\bmfa|\b2fa/i;
  const SECRET_ATTRS = ["name", "id", "data-testid", "aria-label"];

  // Controls seen as type="password" at any point this session. A show/hide
  // toggle flips the input to type="text", so without this every keystroke after
  // the reveal would be captured in plaintext.
  //
  // Known limitation: heuristic. A secret typed into a field that was never
  // type="password" and whose attributes don't read as secret-bearing is still
  // recorded verbatim, so a generated spec is worth a glance before committing.
  const seenAsPassword = new WeakSet();

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
  let lastEmit = { key: "", at: 0 };
  let hoverBox = null;
  let passwordObserver = null;

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

  function isPasswordField(el) {
    if (!el || el.tagName !== "INPUT") return false;
    return (el.getAttribute("type") || "text").toLowerCase() === "password";
  }

  /**
   * Remember a control that is currently a password field, so a later reveal
   * toggle (type="text") can't launder its value into the recording.
   */
  function notePasswordField(el) {
    if (isPasswordField(el)) seenAsPassword.add(el);
  }

  function noteRevealedPasswords(records) {
    for (const record of records) {
      if (
        record.attributeName === "type" &&
        (record.oldValue || "").toLowerCase() === "password"
      ) {
        seenAsPassword.add(record.target);
      }
    }
  }

  /**
   * MutationObserver callbacks are microtasks, so a reveal toggle and a keystroke
   * landing in the same task would otherwise be evaluated before the flip is
   * known — and that one keystroke captured in plaintext.
   */
  function drainPasswordMutations() {
    if (passwordObserver) noteRevealedPasswords(passwordObserver.takeRecords());
  }

  /**
   * Catch a reveal toggle even for a field never seen as a password: the
   * password→text flip is itself the signal, so a field that was autofilled and
   * then unmasked is still redacted rather than captured in plaintext.
   */
  function watchPasswordReveals() {
    const Observer =
      typeof MutationObserver !== "undefined"
        ? MutationObserver
        : window.MutationObserver;
    if (!Observer || passwordObserver) return;
    passwordObserver = new Observer(noteRevealedPasswords);
    passwordObserver.observe(document.documentElement || document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["type"],
      attributeOldValue: true,
    });
    // Anything already masked when recording starts is a password field even if
    // the user only ever touches its reveal toggle.
    Array.prototype.forEach.call(
      document.querySelectorAll('input[type="password"]'),
      (el) => seenAsPassword.add(el),
    );
  }

  function stopWatchingPasswordReveals() {
    if (!passwordObserver) return;
    passwordObserver.disconnect();
    passwordObserver = null;
  }

  function looksSecretByName(el) {
    if (!el || !el.getAttribute) return false;
    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (
      autocomplete.includes("password") ||
      autocomplete === "one-time-code" ||
      autocomplete === "cc-number" ||
      autocomplete === "cc-csc"
    ) {
      return true;
    }
    return SECRET_ATTRS.some((attr) =>
      SECRET_NAME_RE.test(el.getAttribute(attr) || ""),
    );
  }

  /** Whether this control's value must be redacted rather than recorded. */
  function isSecretField(el) {
    if (isPasswordField(el)) {
      seenAsPassword.add(el);
      return true;
    }
    drainPasswordMutations();
    return seenAsPassword.has(el) || looksSecretByName(el);
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
   * Resolve the control a pointer interaction concerns. Clicking a <label>
   * activates its associated control, so map to that and let the control's own
   * `change`/`click` drive recording. Null for non-form-controls.
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
        // Playwright exposes number inputs as `spinbutton`; calling them
        // textboxes would generate a locator that matches nothing at replay.
        if (type === "number") return "spinbutton";
        if (["text", "email", "tel", "url"].includes(type)) return "textbox";
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
  // Per-`selectorFor`-call scratch space. Each candidate kind would otherwise
  // re-walk the document recomputing role + accessible name — several O(N)
  // sweeps per event, in the capture phase. Memoizing collapses that to one.
  let scan = null;

  function beginScan() {
    scan = { all: null, roles: new Map(), names: new Map() };
  }

  function endScan() {
    scan = null;
  }

  function allElements() {
    if (scan) {
      if (!scan.all) {
        scan.all = Array.prototype.slice.call(document.querySelectorAll("*"));
      }
      return scan.all;
    }
    return Array.prototype.slice.call(document.querySelectorAll("*"));
  }

  function roleOf(el) {
    if (!scan) return computeRole(el);
    if (!scan.roles.has(el)) scan.roles.set(el, computeRole(el));
    return scan.roles.get(el);
  }

  function accNameOf(el) {
    if (!scan) return computeAccName(el);
    if (!scan.names.has(el)) scan.names.set(el, computeAccName(el));
    return scan.names.get(el);
  }

  /**
   * Whether an element is exposed to the a11y tree the way Playwright's
   * `getByRole` sees it (`includeHidden: false`). Uniqueness and `nth` are
   * computed from these matches, so counting a hidden duplicate — a closed
   * dialog's buttons, a `display: none` mobile nav — would hand replay an
   * `.nth(1)` pointing at an element Playwright never sees.
   */
  function isAriaVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    for (
      let node = el;
      node && node.nodeType === 1;
      node = node.parentElement
    ) {
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") {
        return false;
      }
      if (node.hasAttribute && node.hasAttribute("hidden")) return false;
    }
    // `checkVisibility` accounts for an ancestor's `display: none`,
    // `content-visibility`, and detached subtrees. Walking computed styles
    // cannot: `display` doesn't inherit, so a child of a hidden container
    // computes to `block` and reads as visible.
    if (typeof el.checkVisibility === "function") {
      try {
        // Playwright treats `visibility: hidden` as hidden but NOT `opacity: 0`,
        // so `visibilityProperty` is on and `opacityProperty` stays off.
        return el.checkVisibility({
          visibilityProperty: true,
          contentVisibilityAuto: true,
        });
      } catch {
        // fall through to the manual check
      }
    }
    // happy-dom and other minimal DOMs don't implement layout; treat "can't
    // tell" as visible so selector quality degrades rather than breaking.
    const view =
      (el.ownerDocument && el.ownerDocument.defaultView) ||
      (typeof window !== "undefined" ? window : null);
    if (!view || typeof view.getComputedStyle !== "function") return true;
    for (
      let node = el;
      node && node.nodeType === 1;
      node = node.parentElement
    ) {
      let style;
      try {
        style = view.getComputedStyle(node);
      } catch {
        return true;
      }
      if (!style) return true;
      if (style.display === "none") return false;
      // `visibility` inherits, so only the element's own computed value matters.
      if (node === el && style.visibility === "hidden") return false;
    }
    return true;
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
            roleOf(e) === descriptor.value &&
            accNameOf(e) === descriptor.name &&
            isAriaVisible(e),
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

  /**
   * Candidate descriptors for `el`, highest priority first.
   *
   * Every name/text-based candidate carries `exact: true`: Playwright matches
   * names as case-insensitive substrings by default, but the uniqueness check
   * below compares with `===`. Without it the recorder would call a "Save" button
   * unique and omit `.nth()`, while replay also matched "Save draft".
   */
  function buildCandidates(el) {
    const candidates = [];

    const testid = el.getAttribute && el.getAttribute("data-testid");
    if (testid) candidates.push({ kind: "testid", value: testid });

    const role = roleOf(el);
    const name = accNameOf(el);
    if (role && name)
      candidates.push({ kind: "role", value: role, name, exact: true });

    const placeholder = el.getAttribute && el.getAttribute("placeholder");
    if (placeholder)
      candidates.push({ kind: "placeholder", value: placeholder, exact: true });

    const label = labelForGetByLabel(el);
    if (label) candidates.push({ kind: "label", value: label, exact: true });

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
    // The walk stops before <body>, so an element that *is* body produces no
    // segments — and `locator("")` throws at replay. Name the element instead.
    if (parts.length === 0) {
      return {
        kind: "css",
        value: el === document.documentElement ? "html" : "body",
      };
    }
    return { kind: "css", value: parts.join(" > ") };
  }

  /**
   * The highest-priority candidate that uniquely matches `el`; else the
   * highest-priority one disambiguated by an nth index; else a CSS-path fallback.
   *
   * Candidates are resolved lazily and the loop returns on the first unique
   * match, so an element carrying a `data-testid` never pays for the
   * whole-document role scan behind it.
   */
  function selectorFor(el) {
    beginScan();
    try {
      const candidates = buildCandidates(el);
      const resolved = [];
      for (const descriptor of candidates) {
        const matches = queryAll(descriptor);
        if (!matches.includes(el)) continue;
        if (matches.length === 1) return descriptor;
        resolved.push({ descriptor, matches });
      }
      for (const { descriptor, matches } of resolved) {
        if (matches.length <= 20) {
          return { ...descriptor, nth: matches.indexOf(el) };
        }
      }
      return cssPathDescriptor(el);
    } finally {
      endScan();
    }
  }

  // Typing is the only genuinely hot path: `input` fires per keystroke and the
  // element doesn't move between them, so reuse its descriptor instead of
  // re-sweeping the document each time. Only an uninterrupted run of `input` on
  // the same element reuses it — any other interaction can have changed the DOM
  // enough to make the cached locator ambiguous, so those clear it.
  let lastFill = { el: null, locator: null };

  function clearFillLocator() {
    lastFill = { el: null, locator: null };
  }

  function fillLocatorFor(el) {
    if (lastFill.el === el && el.isConnected) return lastFill.locator;
    const locator = selectorFor(el);
    lastFill = { el, locator };
    return locator;
  }

  /* ---------- emit / dedupe -------------------------------------------- */
  function emit(action) {
    const key = JSON.stringify(action);
    const now = Date.now();
    if (key === lastEmit.key && now - lastEmit.at < DEDUPE_MS) return;
    lastEmit = { key, at: now };
    window.parent.postMessage({ type: "dyad-recorder-action", action }, "*");
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
    clearFillLocator();
    const raw = deepTarget(e);

    const control = resolveControl(raw);
    if (control) {
      // Seen before any reveal toggle can flip it to type="text".
      notePasswordField(control);
      // Form controls are recorded from `change` (toggles, selects) or `input`
      // (text); skip the click so we don't double-record.
      if (
        isCheckboxOrRadio(control) ||
        control.tagName === "SELECT" ||
        isEditable(control)
      ) {
        return;
      }
    }

    // Emitted now, not after a debounce: a click on a link unloads this document
    // within milliseconds and a stalled click would go with it. The clicks
    // preceding a double-click are folded in by the renderer's `collapseActions`.
    const target = retarget(raw);
    emit({ kind: "click", locator: selectorFor(target) });
  }

  function onDblClick(e) {
    if (!active || !trustedOk(e) || isOverlayEvent(e)) return;
    const target = retarget(deepTarget(e));
    emit({ kind: "dblclick", locator: selectorFor(target) });
  }

  function onInput(e) {
    if (!active || !trustedOk(e)) return;
    const t = deepTarget(e);
    if (!t || t.nodeType !== 1) return;
    if (t.tagName === "SELECT") return; // handled by `change`
    if (!isEditable(t)) return;
    if (isSecretField(t)) {
      // Redact at capture time so the plaintext never leaves the iframe.
      emit({
        kind: "fill",
        locator: fillLocatorFor(t),
        value: PASSWORD_PLACEHOLDER,
      });
      return;
    }
    const value = t.isContentEditable ? t.innerText : t.value;
    emit({
      kind: "fill",
      locator: fillLocatorFor(t),
      value: value == null ? "" : value,
    });
  }

  function onChange(e) {
    if (!active || !trustedOk(e)) return;
    clearFillLocator();
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
    clearFillLocator();
    const target = retarget(deepTarget(e));
    // Keys fired with nothing focused target <body>, which has no meaningful
    // locator; record those as a page-level `page.keyboard.press`.
    if (
      !target ||
      target === document.body ||
      target === document.documentElement
    ) {
      emit({ kind: "press", key: keyCombo(e) });
      return;
    }
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
      border: "2px solid #a855f7",
      background: "rgba(168,85,247,0.08)",
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
    notePasswordField(target);
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
    watchPasswordReveals();
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
    stopWatchingPasswordReveals();
    clearFillLocator();
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
