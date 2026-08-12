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
 * lost with the unloading document — and only the first click of a multi-click
 * gesture is reported, so the renderer's `collapseActions` folds exactly one
 * click into the `dblclick` that follows it.
 *
 * Plain, dependency-free IIFE JS: it is read verbatim and injected into every
 * previewed HTML document. See `src/lib/test_recorder/types.ts` for the schemas
 * of the actions and locator descriptors it emits.
 *
 * Protocol:
 *   down (from parent): { type: "activate-dyad-recorder" | "deactivate-dyad-recorder", token }
 *                       { type: "flush-dyad-recorder", token, requestId }
 *   up   (to parent):   { type: "dyad-recorder-initialized" }
 *                       { type: "dyad-recorder-action", action: RecordedAction }
 *                       { type: "dyad-recorder-flushed", requestId }
 *
 * Known limitation — the top-level preview document only. This script is
 * injected into nested frames too, but Dyad activates only the frame it embeds,
 * and `window.parent` from a nested document is the app, not the renderer. So
 * interactions inside an app's own iframes are absent from the recording rather
 * than misrecorded. Covering them needs the activation relayed down, the actions
 * relayed back up, and a frame reference carried on each action so replay can
 * address it via `page.frameLocator` — without that last part a relayed action
 * would replay against the main frame and silently assert the wrong document.
 * Tracked as follow-up work; see the PR discussion.
 */
(() => {
  // Read once, here, and then take the global away.
  //
  // The vm/happy-dom unit test sets this before the script runs so it can drive
  // the recorder with synthetic events. Nothing else legitimately sets it, and
  // the proxy splices this script in immediately after `<head>` — so every one
  // of the app's own scripts, inline or bundled or from a CDN, runs strictly
  // after this line. Snapshotting is therefore enough to stop a page script
  // flipping the recorder into accepting untrusted events mid-recording and
  // fabricating clicks and fills that land in a spec the user commits and runs.
  const allowUntrustedEvents =
    window.__DYAD_RECORDER_ALLOW_UNTRUSTED__ === true;
  // Minted per proxy and known only to the trusted renderer. Without this, an
  // unrelated page can frame the localhost preview, arm the recorder, and
  // receive every captured fill value through the parent message channel.
  const recorderToken = document.currentScript?.dataset.dyadRecorderToken;
  try {
    delete window.__DYAD_RECORDER_ALLOW_UNTRUSTED__;
  } catch {
    // Non-configurable, so someone is holding it deliberately. The snapshot
    // above already decided this session's answer either way.
  }

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

  // Native elements that are interactive whatever their role says.
  const INTERACTIVE_TAGS = "button, a, input, select, textarea, summary";

  // Roles that make an element the thing a click is really aimed at. Matched
  // against `computeRole`'s answer rather than the `role` attribute's text: only
  // the first supported token of a fallback list is live, so
  // `role="presentation button"` is a presentation element that merely contains
  // the word "button". Retargeting to it would record the click against a
  // wrapper and leave the real handler on the descendant unexercised on replay.
  const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "checkbox",
    "radio",
    "tab",
    "menuitem",
    "switch",
    "option",
  ]);

  // WAI-ARIA 1.2 roles, which is what Playwright's `getByRole` accepts. Used to
  // pick the winning token out of a fallback role list — see `computeRole`.
  const KNOWN_ROLES = new Set([
    "alert",
    "alertdialog",
    "application",
    "article",
    "banner",
    "blockquote",
    "button",
    "caption",
    "cell",
    "checkbox",
    "code",
    "columnheader",
    "combobox",
    "complementary",
    "contentinfo",
    "definition",
    "deletion",
    "dialog",
    "directory",
    "document",
    "emphasis",
    "feed",
    "figure",
    "form",
    "generic",
    "grid",
    "gridcell",
    "group",
    "heading",
    "img",
    "insertion",
    "link",
    "list",
    "listbox",
    "listitem",
    "log",
    "main",
    "marquee",
    "math",
    "menu",
    "menubar",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "meter",
    "navigation",
    "none",
    "note",
    "option",
    "paragraph",
    "presentation",
    "progressbar",
    "radio",
    "radiogroup",
    "region",
    "row",
    "rowgroup",
    "rowheader",
    "scrollbar",
    "search",
    "searchbox",
    "separator",
    "slider",
    "spinbutton",
    "status",
    "strong",
    "subscript",
    "superscript",
    "switch",
    "tab",
    "table",
    "tablist",
    "tabpanel",
    "term",
    "textbox",
    "time",
    "timer",
    "toolbar",
    "tooltip",
    "tree",
    "treegrid",
    "treeitem",
  ]);

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
  /**
   * The last Enter press this recorder actually recorded, and where.
   *
   * Enter in a text field inside a form submits it implicitly, and the browser
   * delivers that submission as a trusted `click` on the form's default submit
   * button. Recording both replays the submission twice — and since the press
   * navigates first, the duplicate click usually lands on the destination
   * document and fails. `onClick` uses this to recognise that click.
   */
  let lastEnterPress = { target: null, at: 0 };
  /** How long after an Enter press a click may still be its implicit submit. */
  const IMPLICIT_SUBMIT_MS = 100;
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
    return e.isTrusted || allowUntrustedEvents;
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

  /**
   * Controls whose value is chosen rather than typed — a colour picker, a
   * slider. `isEditable` excludes them because there is no text to type, but
   * the value is still the user's choice, and Playwright's `fill` sets these
   * directly instead of typing (its `kInputTypesToSetValue`), so `fill("42")`
   * replays exactly what was picked.
   *
   * Captured from `change` (the commit) rather than `input`, which fires for
   * every frame of a drag.
   */
  const VALUE_PICKER_TYPES = ["color", "range"];

  function isValuePicker(el) {
    if (!el || el.tagName !== "INPUT") return false;
    return VALUE_PICKER_TYPES.includes(
      (el.getAttribute("type") || "").toLowerCase(),
    );
  }

  /**
   * A file picker. Nothing here can be replayed: the value is a file the user
   * chose from their own machine, which the page cannot read and this recorder
   * has no business capturing. A recorded `click()` is worse than no step —
   * replay opens the OS file chooser and the test hangs there.
   */
  function isFileInput(el) {
    if (!el || el.tagName !== "INPUT") return false;
    return (el.getAttribute("type") || "").toLowerCase() === "file";
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

  /**
   * Controls that arrow keys DRIVE rather than merely move a caret within, so
   * the keypress produces a `change` this recorder already captures as the
   * value action.
   *
   * A `<select>` walks its options, range and number inputs step, and arrows
   * inside a radio group both move focus and check the radio they land on.
   * Recording the press as well as the resulting `select`/`fill`/`check` makes
   * replay perform the value change twice — once by keystroke, once by the
   * value action — and land somewhere the user never went. Text fields are not
   * here: arrows only move the caret, and no `change` follows.
   *
   * Checkboxes are deliberately absent even though radios are here. Arrows do
   * nothing to a checkbox — there is no group to walk and no `change` to take
   * the press's place — so suppressing it would erase the only record of a
   * keyboard-only interaction with the app's own key handler.
   */
  function changesValueOnArrowKeys(control) {
    if (!control || control.nodeType !== 1) return false;
    if (control.tagName === "SELECT") return true;
    if (control.tagName !== "INPUT") return false;
    const type = (control.getAttribute("type") || "text").toLowerCase();
    return type === "radio" || type === "range" || type === "number";
  }

  /** Controls whose meaningful action is captured by input/change, not click. */
  function recordsWithoutClick(control) {
    return (
      isCheckboxOrRadio(control) ||
      isValuePicker(control) ||
      isFileInput(control) ||
      control.tagName === "SELECT" ||
      isEditable(control)
    );
  }

  function retarget(el) {
    if (!el || el.nodeType !== 1) return el;
    // Nearest-first, the way `closest` walked it — but asking `computeRole`
    // per node instead of letting a CSS attribute match stand in for the role.
    for (
      let node = el;
      node && node.nodeType === 1;
      node = node.parentElement
    ) {
      if (node.matches && node.matches(INTERACTIVE_TAGS)) return node;
      if (INTERACTIVE_ROLES.has(computeRole(node))) return node;
    }
    return el;
  }

  /* ---------- role / accessible-name (minimal port) -------------------- */
  function computeRole(el) {
    if (!el || el.nodeType !== 1) return null;
    const explicit = el.getAttribute && el.getAttribute("role");
    if (explicit && explicit.trim()) {
      // `role` is a space-separated fallback list, and the browser takes the
      // first token it recognises — `role="switch checkbox"` is a switch. Handing
      // the whole attribute over as one role emits
      // `getByRole("switch checkbox")`, which matches nothing on replay.
      for (const token of explicit.trim().toLowerCase().split(/\s+/)) {
        if (KNOWN_ROLES.has(token)) return token;
      }
      // Every token was junk. Browsers ignore an unrecognised `role` and fall
      // back to the implicit one, so drop through rather than returning null.
    }
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    switch (tag) {
      case "button":
        return "button";
      case "a":
        return el.hasAttribute("href") ? "link" : null;
      case "select":
        // A select is a combobox only while it presents one row at a time.
        // `multiple`, or a `size` above 1, makes it a list — and Playwright
        // matches it as `listbox`, so calling it a combobox generates a locator
        // that never resolves.
        return el.hasAttribute("multiple") ||
          Number(el.getAttribute("size")) > 1
          ? "listbox"
          : "combobox";
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
        // No ARIA role Playwright can match. Falling through to `textbox` would
        // let a unique-looking `getByRole("textbox", { name })` win over
        // `getByLabel` and generate a locator that resolves to nothing every
        // time the test runs.
        if (
          [
            "date",
            "datetime-local",
            "month",
            "week",
            "time",
            "color",
            "file",
            "hidden",
          ].includes(type)
        ) {
          return null;
        }
        // An unknown or missing type behaves as `text`, so textbox is right for
        // everything left.
        return "textbox";
      }
      default:
        return null;
    }
  }

  function associatedLabelText(el) {
    if (!el || el.nodeType !== 1) return null;
    // Native labelable controls expose every associated label in document
    // order through `.labels`, including both `for=` and wrapping labels.
    // Playwright concatenates those labels for the accessible name, so using
    // only the first one can produce a unique-looking locator that never
    // resolves on replay.
    let labels = el.labels ? Array.from(el.labels) : [];
    if (!labels.length) {
      // Fallback for DOM implementations without `HTMLInputElement.labels`.
      if (el.id) {
        labels = Array.from(
          document.querySelectorAll(`label[for="${cssEscape(el.id)}"]`),
        );
      }
      const wrap = el.closest && el.closest("label");
      if (wrap && !labels.includes(wrap)) labels.push(wrap);
    }
    const parts = labels
      .map((label) => normalize(accessibleTextContent(label)))
      .filter(Boolean);
    return parts.length ? normalize(parts.join(" ")) : null;
  }

  /**
   * Text as an accessible-name computation reads it: `aria-hidden` and `hidden`
   * subtrees contribute nothing.
   *
   * Raw `textContent` would name `<button><span aria-hidden="true">×</span>Close
   * </button>` "×Close", and the `getByRole("button", { name: "×Close" })` that
   * produced would match nothing when the test replays — Playwright computes the
   * name the same way this does, and gets "Close".
   */
  function accessibleTextContent(el, includeHidden = false) {
    let out = "";
    const children = el.childNodes || [];
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (node.nodeType === 3) {
        out += node.nodeValue || "";
        continue;
      }
      if (node.nodeType !== 1) continue;
      if (
        !includeHidden &&
        node.getAttribute &&
        node.getAttribute("aria-hidden") === "true"
      )
        continue;
      // The same visibility rule `getByRole` matching uses, so a name built
      // here is one Playwright can actually match. `display: none` and
      // `visibility: hidden` descendants contribute nothing to a name — a
      // screen-reader-only label or a collapsed tooltip would otherwise be
      // baked into a locator that matches nothing at replay.
      if (!includeHidden && !isAriaVisible(node)) continue;
      out += accessibleTextContent(node, includeHidden);
    }
    return out;
  }

  /**
   * The text `aria-labelledby` resolves to, or null when it names nothing.
   *
   * Ahead of `aria-label` wherever both are consulted: the accessible-name
   * algorithm gives `aria-labelledby` precedence (accname step 2B before 2C),
   * and Playwright implements it faithfully. Reading `aria-label` first on an
   * element carrying both makes the uniqueness scan call
   * `getByRole(..., { name: <aria-label>, exact: true })` unique while
   * Playwright computes the referenced text as the name — so the locator
   * matches nothing at replay. A labelledby that resolves to nothing falls
   * through to `aria-label`, as the algorithm's own fallthrough does.
   */
  function labelledByText(el) {
    const labelledby = el.getAttribute && el.getAttribute("aria-labelledby");
    if (!labelledby) return null;
    const parts = labelledby
      .split(/\s+/)
      .map((id) => {
        const ref = document.getElementById(id);
        // Explicit aria-labelledby references contribute even when the
        // referenced node is visually hidden. Ordinary descendants and native
        // labels still use the visibility filter in accessibleTextContent.
        return ref ? normalize(accessibleTextContent(ref, true)) : "";
      })
      .filter(Boolean);
    return parts.length ? normalize(parts.join(" ")) : null;
  }

  function computeAccName(el) {
    if (!el || el.nodeType !== 1) return null;

    const labelled = labelledByText(el);
    if (labelled) return labelled;

    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && aria.trim()) return normalize(aria);

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
      const text = normalize(accessibleTextContent(el));
      if (text) return text;
    }

    const title = el.getAttribute && el.getAttribute("title");
    if (title && title.trim()) return normalize(title);

    return null;
  }

  function labelForGetByLabel(el) {
    // Same precedence as computeAccName, for the same reason: Playwright's
    // `getByLabel` reads aria-labelledby before aria-label too, so the other
    // order produces a locator it will never match.
    const labelled = labelledByText(el);
    if (labelled) return labelled;
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

  /**
   * Every element the locator has to be unique among — open shadow roots
   * included.
   *
   * Playwright's locators pierce open shadow roots, so uniqueness judged from
   * `document.querySelectorAll` alone can call a locator unique while replay
   * finds a second match inside a web component and fails on strict mode.
   */
  function collectElements(root, into) {
    const found = root.querySelectorAll("*");
    for (let i = 0; i < found.length; i++) {
      const el = found[i];
      into.push(el);
      if (el.shadowRoot) collectElements(el.shadowRoot, into);
    }
    return into;
  }

  function allElements() {
    if (scan) {
      if (!scan.all) scan.all = collectElements(document, []);
      return scan.all;
    }
    return collectElements(document, []);
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
   * The next element up, crossing out of a shadow root to its host.
   *
   * `parentElement` returns null at a shadow boundary, so without this a
   * component whose host is `aria-hidden` or `display: none` would have its
   * shadow content counted as visible — and now that uniqueness scans include
   * shadow descendants, that is a locator claiming to be unique against
   * elements Playwright can't see.
   */
  function ariaParent(el) {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode && el.getRootNode();
    return root && root.host ? root.host : null;
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
    for (let node = el; node && node.nodeType === 1; node = ariaParent(node)) {
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
    for (let node = el; node && node.nodeType === 1; node = ariaParent(node)) {
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

    // `data-dyad-id` is deliberately NOT a candidate: it encodes a source
    // location, so it moves whenever the file it points into is edited, and the
    // Dyad plugin that injects it doesn't run in the build the test replays
    // against. An element with no better locator falls through to the CSS path.

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
      // The nodes `node` is indexed among. Inside a shadow root that's the root
      // itself, not an element — `parentElement` is null there.
      const siblingRoot = node.parentElement ?? node.getRootNode();
      const sameTag = Array.prototype.filter.call(
        siblingRoot?.children ?? [],
        (c) => c.tagName === node.tagName,
      );
      if (sameTag.length > 1) {
        part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      // `parentElement` is null at a shadow boundary, which would end the walk
      // there and emit a path rooted inside the component — `div`, say, which
      // Playwright's shadow-piercing CSS then matches all over the page.
      // Continuing through the host keeps the path anchored in the light DOM.
      node = ariaParent(node);
    }
    // The walk stops before <body>, so an element that *is* body produces no
    // segments — and `locator("")` throws at replay. Name the element instead.
    if (parts.length === 0) {
      return {
        kind: "css",
        value: el === document.documentElement ? "html" : "body",
      };
    }
    // Anchored at <body> unless the walk already terminated on an id, or on
    // <html> itself — `body > html` is not a thing, and neither is
    // `body > html > head`. A bare `div:nth-of-type(1) > div` is a pattern, not
    // a path: it matches anywhere that shape recurs, so Playwright's strict mode
    // fails the step or picks the wrong element. `>` from body keeps it a single
    // rooted chain.
    if (parts[0] !== "html" && !parts[0].startsWith("#")) {
      parts.unshift("body");
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

  /**
   * Controls the browser activates by dispatching its own trusted `click` when
   * Enter is pressed on them. `onClick` records that click, so recording the
   * press as well replays the action twice — and for a link or a submit button
   * the press navigates first, leaving the duplicate click to run against the
   * destination document, where it usually fails outright.
   *
   * NATIVE elements only. `role="button"` is a promise about semantics, not
   * behaviour: nothing dispatches a click for it, so the page's own keydown
   * handler is the whole interaction. Suppressing the press there would drop
   * the action from the recording entirely rather than deduplicate it.
   */
  function activatesOnEnter(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === "BUTTON" || el.tagName === "SUMMARY") return true;
    if (el.tagName === "A") return el.hasAttribute("href");
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return ["submit", "button", "reset", "image"].includes(type);
    }
    return false;
  }

  /**
   * Elements the browser itself acts on when Space is pressed, producing
   * something the recorder already captures — a synthesized click, a toggle, a
   * typed character, a native picker.
   *
   * The mirror of `activatesOnEnter`, and deliberately not the same list: an
   * anchor activates on Enter but NOT on Space. So `<a role="button"
   * tabindex="0">` is a custom control as far as Space is concerned, however
   * native its tag — the required Space behaviour is entirely the page's own
   * keydown handler, and a press left unrecorded there vanishes from replay
   * with nothing else standing in for it.
   */
  function activatesOnSpace(el) {
    if (!el || el.nodeType !== 1) return false;
    // Space types a character, which the resulting `fill` carries.
    if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
    // BUTTON/SUMMARY activate; SELECT opens its picker, and whatever is chosen
    // arrives as a `select`. Every INPUT type either acts on Space (checkbox,
    // radio, the button types, file) or types into it.
    return ["BUTTON", "SUMMARY", "SELECT", "INPUT"].includes(el.tagName);
  }

  function shouldRecordPress(e) {
    if (["Control", "Meta", "Alt", "Shift"].includes(e.key)) return false;
    const hasNonShiftModifier = e.ctrlKey || e.metaKey || e.altKey;
    if (hasNonShiftModifier) return true;
    if (e.key === " " || e.key === "Spacebar") {
      const t = deepTarget(e);
      // Browsers synthesize the useful click/change for the controls above, but
      // custom ARIA controls rely on the app's key handler. Record that Space
      // press or keyboard-only interactions disappear from replay entirely.
      if (!t || activatesOnSpace(t)) return false;
      return ["button", "checkbox", "radio", "switch", "menuitem"].includes(
        computeRole(t),
      );
    }
    if (NAV_KEYS.has(e.key)) {
      if (e.key === "Enter") {
        const t = deepTarget(e);
        // Enter inside multi-line editors inserts a newline — that is captured
        // by the resulting `fill`, so don't also record it as a press.
        if (t && (t.tagName === "TEXTAREA" || t.isContentEditable))
          return false;
        if (activatesOnEnter(t)) return false;
        return true;
      }
      // Arrows that drive a native control are already recorded as the value
      // action the resulting `change` produces. Keeping the press too would
      // replay the change twice.
      //
      // Arrow keys only. Escape is in NAV_KEYS as well, and it changes nothing
      // on these controls — so no `change` follows to stand in for the press,
      // and suppressing it would drop the interaction from the recording
      // entirely.
      if (e.key.startsWith("Arrow")) {
        const raw = deepTarget(e);
        const control = resolveControl(raw) || raw;
        if (changesValueOnArrowKeys(control)) return false;
      }
      return true;
    }
    return false;
  }

  /* ---------- event handlers ------------------------------------------- */
  function onClick(e) {
    if (!active || !trustedOk(e) || isOverlayEvent(e)) return;
    // `detail` is the browser's own click counter for the gesture in progress.
    // The 2nd (and later) click of a double-click is reported by the `dblclick`
    // that follows, so dropping them here leaves exactly one click ahead of it
    // — which is what lets `collapseActions` merge without guessing from
    // timestamps it only sees after a postMessage hop.
    if (typeof e.detail === "number" && e.detail >= 2) return;
    const raw = deepTarget(e);
    // The implicit submit an Enter press just triggered. A click the browser
    // synthesises carries `detail === 0`, and this one lands somewhere other
    // than where Enter was pressed — that pair is what tells it apart from
    // Enter pressed directly on a button, whose press is suppressed instead so
    // that click is the only record of the action.
    if (
      e.detail === 0 &&
      lastEnterPress.target &&
      lastEnterPress.target !== raw &&
      Date.now() - lastEnterPress.at < IMPLICIT_SUBMIT_MS
    ) {
      return;
    }
    clearFillLocator();

    const control = resolveControl(raw);
    if (control) {
      // Seen before any reveal toggle can flip it to type="text".
      notePasswordField(control);
      // Form controls are recorded from `change` (toggles, selects) or `input`
      // (text); skip the click so we don't double-record.
      if (recordsWithoutClick(control)) {
        return;
      }
    }

    // Emitted now, not after a debounce: a click on a link unloads this document
    // within milliseconds and a stalled click would go with it. The click
    // preceding a double-click is folded in by the renderer's `collapseActions`.
    // A label click dispatches a second trusted click on its associated
    // click-driven control. Targeting the control here makes both emissions
    // identical, so `emit` deduplicates the browser-generated second click.
    const target = control || retarget(raw);
    emit({ kind: "click", locator: selectorFor(target) });
  }

  function onDblClick(e) {
    if (!active || !trustedOk(e) || isOverlayEvent(e)) return;
    const raw = deepTarget(e);
    const control = resolveControl(raw);
    // Each click composing the gesture already fired `change` on these, so both
    // are recorded (a double-clicked checkbox emits `check` then `uncheck`) and
    // there is no leading `click` for `collapseActions` to absorb. Emitting the
    // double-click as well would replay four activations for the user's two.
    if (control && recordsWithoutClick(control)) return;
    // Match the leading-click target for label-activated click controls so the
    // renderer can collapse click + dblclick into one double-click action.
    const target = control || retarget(raw);
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

    if (isValuePicker(t)) {
      emit({
        kind: "fill",
        locator: fillLocatorFor(t),
        value: t.value == null ? "" : t.value,
      });
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
    const raw = deepTarget(e);
    // Noted before emitting, so the implicit-submit click this may be about to
    // trigger can recognise itself as already recorded. Only Enter submits a
    // form implicitly.
    if (e.key === "Enter") lastEnterPress = { target: raw, at: Date.now() };
    const target = retarget(raw);
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

  /**
   * Take the highlight out of the document entirely, rather than just hiding
   * it. Hiding is right between pointer moves; this runs when recording stops,
   * and this script's whole contract is that the app is left exactly as it
   * would have been without it.
   */
  function removeHoverBox() {
    if (hoverBox && hoverBox.parentNode) {
      hoverBox.parentNode.removeChild(hoverBox);
    }
    hoverBox = null;
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
    removeHoverBox();
  }

  /* ---------- message bridge ------------------------------------------- */
  // Same reasoning as the auth bootstrap's guard: `e.source === window.parent`
  // is trivially true for a page's own scripts when this document is top-level
  // (opening the preview URL in a real browser), and arming the recorder there
  // would stream everything the user types — `fill` values included — to
  // whoever asked. This script only has a job inside Dyad's preview frame.
  const isFramed = window.parent !== window;

  window.addEventListener("message", (e) => {
    if (!isFramed) return;
    if (e.source !== window.parent) return;
    if (!recorderToken || e.data?.token !== recorderToken) return;
    const type = e.data.type;
    if (type === "activate-dyad-recorder") activate();
    else if (type === "deactivate-dyad-recorder") deactivate();
    else if (
      type === "flush-dyad-recorder" &&
      typeof e.data.requestId === "string"
    ) {
      window.parent.postMessage(
        { type: "dyad-recorder-flushed", requestId: e.data.requestId },
        "*",
      );
    }
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
