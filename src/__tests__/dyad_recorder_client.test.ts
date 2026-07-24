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
  it("posts an initialized message on load", () => {
    const r = setup();
    expect(r.messages).toEqual(
      expect.arrayContaining([{ type: "dyad-recorder-initialized" }]),
    );
  });

  it("records a click using a role + accessible-name locator", () => {
    const r = setup();
    r.setHtml(`<button>Add</button>`);
    r.activate();
    r.click(r.doc.querySelector("button"));
    r.settleClick();

    expect(r.actions).toEqual([
      {
        kind: "click",
        locator: { kind: "role", value: "button", name: "Add" },
      },
    ]);
  });

  it("retargets a click on inner content to the interactive ancestor", () => {
    const r = setup();
    r.setHtml(`<button><span>Go</span></button>`);
    r.activate();
    r.click(r.doc.querySelector("span"));
    r.settleClick();

    expect(r.actions).toEqual([
      { kind: "click", locator: { kind: "role", value: "button", name: "Go" } },
    ]);
  });

  it("supersedes a stalled single click with a double click", () => {
    const r = setup();
    r.setHtml(`<button>Open</button>`);
    r.activate();
    const btn = r.doc.querySelector("button");
    r.click(btn);
    r.dblclick(btn);
    r.settleClick();

    expect(r.actions).toEqual([
      {
        kind: "dblclick",
        locator: { kind: "role", value: "button", name: "Open" },
      },
    ]);
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
        locator: { kind: "placeholder", value: "Email" },
        value: "a",
      },
      {
        kind: "fill",
        locator: { kind: "placeholder", value: "Email" },
        value: "ab",
      },
    ]);
  });

  it("records Enter and modifier shortcuts as presses", () => {
    const r = setup();
    r.setHtml(`<input placeholder="Search" />`);
    r.activate();
    const input = r.doc.querySelector("input");
    r.keydown(input, { key: "Enter" });
    r.keydown(input, { key: "a", ctrlKey: true });

    expect(r.actions).toEqual([
      {
        kind: "press",
        locator: { kind: "placeholder", value: "Search" },
        key: "Enter",
      },
      {
        kind: "press",
        locator: { kind: "placeholder", value: "Search" },
        key: "Control+A",
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
        locator: { kind: "role", value: "checkbox", name: "Subscribe" },
      },
      {
        kind: "uncheck",
        locator: { kind: "role", value: "checkbox", name: "Subscribe" },
      },
      {
        kind: "check",
        locator: { kind: "role", value: "radio", name: "Plan" },
      },
    ]);
  });

  it("records a select change with the chosen option values", () => {
    const r = setup();
    r.setHtml(
      `<select aria-label="Color"><option value="red">Red</option>` +
        `<option value="green">Green</option></select>`,
    );
    r.activate();
    const select = r.doc.querySelector("select");
    select.value = "green";
    r.change(select);

    expect(r.actions).toEqual([
      {
        kind: "select",
        locator: { kind: "role", value: "combobox", name: "Color" },
        values: ["green"],
      },
    ]);
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
        locator: { kind: "role", value: "button", name: "Item", nth: 1 },
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
