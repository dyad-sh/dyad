import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recorderSource = fs.readFileSync(
  path.resolve(process.cwd(), "worker/dyad-recorder-client.js"),
  "utf8",
);

const CLICK_DEBOUNCE_MS = 200;

type AnyEl = any;

/**
 * Load the recorder client into a fresh vm context that shares a real
 * happy-dom document (so selector generation and event dispatch exercise a real
 * DOM), while `window` is a controllable mock that captures postMessage traffic
 * and the registered message handler.
 */
function setup({ allowUntrusted = true }: { allowUntrusted?: boolean } = {}) {
  const hw = new Window({ url: "https://preview.test/" });
  const doc: AnyEl = hw.document;

  const messages: any[] = [];
  const actions: any[] = [];
  const parent = {
    postMessage: (msg: any) => {
      messages.push(msg);
      if (msg && msg.type === "dyad-recorder-action") actions.push(msg.action);
    },
  };

  let messageHandler: ((e: any) => void) | undefined;
  const win: any = {
    parent,
    CSS: (hw as any).CSS,
    MutationObserver: (hw as any).MutationObserver,
    __DYAD_RECORDER_ALLOW_UNTRUSTED__: allowUntrusted,
    addEventListener: (type: string, handler: any) => {
      if (type === "message") messageHandler = handler;
    },
    removeEventListener: () => {},
  };
  win.window = win;

  const sandbox: any = {
    window: win,
    document: doc,
    MutationObserver: (hw as any).MutationObserver,
    console: { debug() {}, warn() {}, error() {}, log() {} },
    setTimeout: (fn: any, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (id: any) => clearTimeout(id),
    Date,
  };

  vm.runInNewContext(recorderSource, sandbox);
  if (!messageHandler) {
    throw new Error("recorder client did not register a message handler");
  }
  // Ensure the "initialized" ping fires regardless of happy-dom readyState.
  if (!messages.some((m) => m.type === "dyad-recorder-initialized")) {
    doc.dispatchEvent(new hw.Event("DOMContentLoaded"));
  }

  const setHtml = (html: string) => {
    doc.body.innerHTML = html;
  };
  const activate = () =>
    messageHandler!({
      source: parent,
      data: { type: "activate-dyad-recorder" },
    });
  const deactivate = () =>
    messageHandler!({
      source: parent,
      data: { type: "deactivate-dyad-recorder" },
    });

  const click = (el: AnyEl) =>
    el.dispatchEvent(
      new hw.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  const dblclick = (el: AnyEl) =>
    el.dispatchEvent(new hw.MouseEvent("dblclick", { bubbles: true }));
  const typeInto = (el: AnyEl, value: string) => {
    el.value = value;
    el.dispatchEvent(new hw.Event("input", { bubbles: true }));
  };
  const change = (el: AnyEl) =>
    el.dispatchEvent(new hw.Event("change", { bubbles: true }));
  const keydown = (el: AnyEl, init: Record<string, unknown>) =>
    el.dispatchEvent(
      new hw.KeyboardEvent("keydown", { bubbles: true, ...init }),
    );
  const mousemove = (el: AnyEl) =>
    el.dispatchEvent(new hw.MouseEvent("mousemove", { bubbles: true }));
  const overlays = () => doc.querySelectorAll(".__dyad_recorder_overlay__");

  return {
    hw,
    doc,
    win,
    messages,
    actions,
    setHtml,
    activate,
    deactivate,
    click,
    dblclick,
    typeInto,
    change,
    keydown,
    mousemove,
    overlays,
    settleClick: () => vi.advanceTimersByTime(CLICK_DEBOUNCE_MS),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("dyad recorder client", () => {
  it("reports a click immediately, leaving the dblclick merge to the renderer", () => {
    const r = setup();
    r.setHtml(`<button>Open</button>`);
    r.activate();
    const btn = r.doc.querySelector("button");
    r.click(btn);
    // Nothing is stalled waiting for a possible double-click: a click that
    // navigates unloads this document long before any debounce would fire, and
    // the click would be lost with it. `collapseActions` folds the leading
    // clicks into the dblclick during review instead.
    expect(r.actions).toHaveLength(1);

    r.dblclick(btn);
    r.settleClick();

    const locator = {
      kind: "role",
      value: "button",
      name: "Open",
      exact: true,
    };
    expect(r.actions).toEqual([
      { kind: "click", locator },
      { kind: "dblclick", locator },
    ]);
  });

  it("records two different controls clicked in quick succession", () => {
    const r = setup();
    r.setHtml(`<button>First</button><button>Second</button>`);
    r.activate();
    const [first, second] = r.doc.querySelectorAll("button");
    r.click(first);
    r.click(second);

    expect(r.actions.map((a: any) => a.locator.name)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("uses the spinbutton role for a number input", () => {
    const r = setup();
    r.setHtml(`<input type="number" aria-label="Quantity" />`);
    r.activate();
    r.typeInto(r.doc.querySelector("input"), "3");

    expect(r.actions).toEqual([
      {
        kind: "fill",
        locator: {
          kind: "role",
          value: "spinbutton",
          name: "Quantity",
          exact: true,
        },
        value: "3",
      },
    ]);
  });

  it("records a page-level shortcut without a locator", () => {
    const r = setup();
    r.setHtml(`<p>nothing focused</p>`);
    r.activate();
    r.keydown(r.doc.body, { key: "Escape" });

    expect(r.actions).toEqual([{ kind: "press", key: "Escape" }]);
  });

  it("falls back to a body selector rather than an empty one", () => {
    const r = setup();
    r.setHtml(`<p>background</p>`);
    r.activate();
    r.click(r.doc.body);

    expect(r.actions).toEqual([
      { kind: "click", locator: { kind: "css", value: "body" } },
    ]);
  });

  it("redacts a password field revealed before the recorder ever saw it", () => {
    const r = setup();
    // A name that reads as ordinary, so only the type flip can catch it.
    r.setHtml(`<input type="password" name="field-x" />`);
    r.activate();
    const input = r.doc.querySelector("input");
    // Never hovered, never clicked, never typed into while masked — the app's
    // reveal toggle is the recorder's first sight of this control.
    input.setAttribute("type", "text");
    r.typeInto(input, "hunter2");

    expect(r.actions.map((action: any) => action.value)).toEqual([
      "REPLACE_WITH_PASSWORD",
    ]);
    expect(JSON.stringify(r.actions)).not.toContain("hunter2");
  });

  it("records typing as a growing fill, never as key presses", () => {
    const r = setup();
    r.setHtml(`<input placeholder="Email" />`);
    r.activate();
    const input = r.doc.querySelector("input");
    r.typeInto(input, "a");
    r.typeInto(input, "ab");
    r.keydown(input, { key: "b" });

    expect(r.actions).toEqual([
      {
        kind: "fill",
        locator: { kind: "placeholder", value: "Email", exact: true },
        value: "a",
      },
      {
        kind: "fill",
        locator: { kind: "placeholder", value: "Email", exact: true },
        value: "ab",
      },
    ]);
  });

  it("redacts a typed password instead of capturing the plaintext value", () => {
    const r = setup();
    r.setHtml(`<input type="password" aria-label="Password" />`);
    r.activate();
    const input = r.doc.querySelector("input");
    r.typeInto(input, "hunter2");

    expect(r.actions).toEqual([
      {
        kind: "fill",
        locator: { kind: "label", value: "Password", exact: true },
        value: "REPLACE_WITH_PASSWORD",
      },
    ]);
  });

  it("keeps redacting a password field after a show/hide toggle reveals it", () => {
    const r = setup();
    r.setHtml(`<input type="password" aria-label="Password" />`);
    r.activate();
    const input = r.doc.querySelector("input");
    // Typed while masked, so the field is observed as a password...
    r.typeInto(input, "hunter");
    // ...then the app's reveal toggle flips it to plain text. Everything typed
    // after that would otherwise be captured verbatim into a committed spec.
    input.setAttribute("type", "text");
    r.typeInto(input, "hunter2");

    // Every value stayed redacted (identical consecutive fills collapse, so one
    // action is expected) and no plaintext reached the parent.
    expect(r.actions.map((action: any) => action.value)).toEqual([
      "REPLACE_WITH_PASSWORD",
    ]);
    expect(JSON.stringify(r.actions)).not.toContain("hunter");
  });

  it("redacts a secret-bearing field that was never type=password", () => {
    const r = setup();
    r.setHtml(`<input name="apiKey" placeholder="API key" />`);
    r.activate();
    r.typeInto(r.doc.querySelector("input"), "sk-live-abc123");

    expect(r.actions).toEqual([
      {
        kind: "fill",
        locator: { kind: "placeholder", value: "API key", exact: true },
        value: "REPLACE_WITH_PASSWORD",
      },
    ]);
  });

  it("records an ordinary field's value verbatim", () => {
    const r = setup();
    r.setHtml(`<input name="email" placeholder="Email address" />`);
    r.activate();
    r.typeInto(r.doc.querySelector("input"), "someone@example.com");

    expect(r.actions).toEqual([
      {
        kind: "fill",
        locator: { kind: "placeholder", value: "Email address", exact: true },
        value: "someone@example.com",
      },
    ]);
  });

  it("records checkbox and radio toggles from change events", () => {
    const r = setup();
    r.setHtml(
      `<input type="checkbox" aria-label="Subscribe" />` +
        `<input type="radio" aria-label="Plan" />`,
    );
    r.activate();
    const checkbox = r.doc.querySelector('input[type="checkbox"]');
    const radio = r.doc.querySelector('input[type="radio"]');

    checkbox.checked = true;
    r.change(checkbox);
    checkbox.checked = false;
    r.change(checkbox);
    radio.checked = true;
    r.change(radio);

    expect(r.actions).toEqual([
      {
        kind: "check",
        locator: {
          kind: "role",
          value: "checkbox",
          name: "Subscribe",
          exact: true,
        },
      },
      {
        kind: "uncheck",
        locator: {
          kind: "role",
          value: "checkbox",
          name: "Subscribe",
          exact: true,
        },
      },
      {
        kind: "check",
        locator: { kind: "role", value: "radio", name: "Plan", exact: true },
      },
    ]);
  });

  it("records a dropdown choice as a select with the chosen value", () => {
    const r = setup();
    r.setHtml(
      `<label for="colour">Colour</label>` +
        `<select id="colour">` +
        `<option value="red">Red</option><option value="blue">Blue</option>` +
        `</select>`,
    );
    r.activate();
    const select = r.doc.querySelector("select");
    select.value = "blue";
    r.change(select);

    // A select is a combobox only while it presents one row at a time — that is
    // what Playwright matches it as, so anything else generates a locator that
    // never resolves.
    expect(r.actions).toEqual([
      {
        kind: "select",
        locator: {
          kind: "role",
          value: "combobox",
          name: "Colour",
          exact: true,
        },
        values: ["blue"],
      },
    ]);
  });

  it("records a multi-select as a listbox with every chosen value", () => {
    const r = setup();
    r.setHtml(
      `<select multiple aria-label="Toppings">` +
        `<option value="ham">Ham</option>` +
        `<option value="olives">Olives</option>` +
        `<option value="basil">Basil</option>` +
        `</select>`,
    );
    r.activate();
    const select = r.doc.querySelector("select");
    select.options[0].selected = true;
    select.options[2].selected = true;
    r.change(select);

    // `multiple` makes it a list, and Playwright matches it as `listbox`.
    expect(r.actions).toEqual([
      {
        kind: "select",
        locator: {
          kind: "role",
          value: "listbox",
          name: "Toppings",
          exact: true,
        },
        values: ["ham", "basil"],
      },
    ]);
  });

  // Enter in a text field inside a form submits it, and the browser delivers
  // that submission as its own trusted click on the default submit button.
  // Recording both replays the submission twice — and since the press navigates
  // first, the duplicate click usually lands on the destination document.
  it("records an implicit form submit once, not as a press and a click", () => {
    const r = setup();
    r.setHtml(
      `<form><input aria-label="Search" /><button type="submit">Go</button></form>`,
    );
    r.activate();

    r.keydown(r.doc.querySelector("input"), { key: "Enter" });
    r.click(r.doc.querySelector("button"));

    expect(r.actions.map((a: any) => a.kind)).toEqual(["press"]);
  });

  it("records Enter pressed on a button as the click it dispatches", () => {
    const r = setup();
    r.setHtml(`<button>Go</button>`);
    r.activate();
    const button = r.doc.querySelector("button");

    // The press is suppressed instead, so the browser's own click is the single
    // record of the action. Suppressing the click here would drop it entirely.
    r.keydown(button, { key: "Enter" });
    r.click(button);

    expect(r.actions.map((a: any) => a.kind)).toEqual(["click"]);
  });

  it("keeps recording a click made after the implicit-submit window", () => {
    const r = setup();
    r.setHtml(
      `<form><input aria-label="Search" /><button type="submit">Go</button></form>`,
    );
    r.activate();

    r.keydown(r.doc.querySelector("input"), { key: "Enter" });
    // Long enough that this can no longer be the submission that press caused;
    // it is the user clicking the button themselves.
    vi.advanceTimersByTime(200);
    r.click(r.doc.querySelector("button"));

    expect(r.actions.map((a: any) => a.kind)).toEqual(["press", "click"]);
  });

  it("takes its hover highlight out of the document when recording stops", () => {
    const r = setup();
    r.setHtml(`<button>Go</button>`);
    r.activate();
    r.mousemove(r.doc.querySelector("button"));
    expect(r.overlays()).toHaveLength(1);

    r.deactivate();

    // Observe-only cuts both ways: once recording is over the app's DOM has to
    // look exactly as it would have without the recorder in it.
    expect(r.overlays()).toHaveLength(0);
  });

  it("prefers a data-testid locator over other strategies", () => {
    const r = setup();
    r.setHtml(`<button data-testid="submit-btn">Submit</button>`);
    r.activate();
    r.click(r.doc.querySelector("button"));
    r.settleClick();

    expect(r.actions).toEqual([
      { kind: "click", locator: { kind: "testid", value: "submit-btn" } },
    ]);
  });

  it("falls back to a CSS path rather than a data-dyad-id", () => {
    const r = setup();
    // The attribute is a source location injected only by Dyad's dev plugin, so
    // a locator built from it points at a moving target the replayed build
    // doesn't even carry.
    r.setHtml(`<div data-dyad-id="src/App.tsx:12:4"><span></span></div>`);
    r.activate();
    r.click(r.doc.querySelector("span"));
    r.settleClick();

    // Anchored at body: `div > span` on its own is a shape, not a path, and
    // matches anywhere that shape recurs — which fails Playwright's strict mode
    // at replay or picks a different element than the one clicked.
    expect(r.actions).toEqual([
      { kind: "click", locator: { kind: "css", value: "body > div > span" } },
    ]);
  });

  it("names the root element without a body prefix", () => {
    const r = setup();
    r.setHtml(`<div></div>`);
    r.activate();
    r.click(r.doc.documentElement);
    r.settleClick();

    // `body > html` is not a selector; the root has to stand alone.
    expect(r.actions).toEqual([
      { kind: "click", locator: { kind: "css", value: "html" } },
    ]);
  });

  it("records nothing for a file picker, which replay cannot reproduce", () => {
    const r = setup();
    r.setHtml(`<input type="file" aria-label="Avatar" />`);
    r.activate();
    r.click(r.doc.querySelector("input"));
    r.settleClick();

    // The chosen file is the user's own and unreadable from here; a bare click
    // replays as "open the OS file chooser and wait forever".
    expect(r.actions).toEqual([]);
  });

  it("anchors a CSS fallback at the nearest id instead of body", () => {
    const r = setup();
    // An id is already unique, so it is the better root — and prefixing `body`
    // past it would only make the chain longer and more brittle.
    r.setHtml(`<div id="panel"><section><span></span></section></div>`);
    r.activate();
    r.click(r.doc.querySelector("span"));
    r.settleClick();

    expect(r.actions).toEqual([
      {
        kind: "click",
        locator: { kind: "css", value: "#panel > section > span" },
      },
    ]);
  });

  it("disambiguates duplicate elements with an nth index", () => {
    const r = setup();
    r.setHtml(`<button>Item</button><button>Item</button>`);
    r.activate();
    const second = r.doc.querySelectorAll("button")[1];
    r.click(second);
    r.settleClick();

    expect(r.actions).toEqual([
      {
        kind: "click",
        locator: {
          kind: "role",
          value: "button",
          name: "Item",
          exact: true,
          nth: 1,
        },
      },
    ]);
  });

  it("ignores a duplicate hidden behind a display:none ancestor when indexing", () => {
    const r = setup();
    // Playwright's getByRole skips hidden elements, so counting this one would
    // hand replay an .nth(1) pointing at an element it never sees.
    r.setHtml(
      `<div style="display: none"><button>Item</button></div>` +
        `<button>Item</button>`,
    );
    r.activate();
    r.click(r.doc.querySelectorAll("button")[1]);

    expect(r.actions).toEqual([
      {
        kind: "click",
        locator: { kind: "role", value: "button", name: "Item", exact: true },
      },
    ]);
  });

  it("stops recording after deactivate", () => {
    const r = setup();
    r.setHtml(`<button>Add</button>`);
    r.activate();
    r.deactivate();
    r.click(r.doc.querySelector("button"));
    r.settleClick();

    expect(r.actions).toEqual([]);
  });

  it("ignores untrusted events when the test escape hatch is off", () => {
    const r = setup({ allowUntrusted: false });
    r.setHtml(`<button>Add</button>`);
    r.activate();
    r.click(r.doc.querySelector("button"));
    r.settleClick();

    expect(r.actions).toEqual([]);
  });
});
