(() => {
  const OVERLAY_ID = "__dyad_overlay__";
  let overlay, label;

  //detect if the user is using Mac
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  // The possible states are:
  // { type: 'inactive' }
  // { type: 'inspecting', element: ?HTMLElement }
  // { type: 'selected', element: HTMLElement }
  let state = { type: "inactive" };

  /* ---------- helpers --------------------------------------------------- */
  const css = (el, obj) => Object.assign(el.style, obj);

  function makeOverlay() {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    css(overlay, {
      position: "absolute",
      border: "2px solid #7f22fe",
      background: "rgba(0,170,255,.05)",
      pointerEvents: "none",
      zIndex: "2147483647", // max
      borderRadius: "4px",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
    });

    label = document.createElement("div");
    css(label, {
      position: "absolute",
      left: "0",
      top: "100%",
      transform: "translateY(4px)",
      background: "#7f22fe",
      color: "#fff",
      fontFamily: "monospace",
      fontSize: "12px",
      lineHeight: "1.2",
      padding: "3px 5px",
      whiteSpace: "nowrap",
      borderRadius: "4px",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.1)",
    });
    overlay.appendChild(label);
    document.body.appendChild(overlay);
  }

  function updateOverlay(el, isSelected = false) {
    if (!overlay) makeOverlay();

    const rect = el.getBoundingClientRect();
    css(overlay, {
      top: `${rect.top + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      display: "block",
      border: isSelected ? "3px solid #7f22fe" : "2px solid #7f22fe",
      background: isSelected
        ? "rgba(127, 34, 254, 0.05)"
        : "rgba(0,170,255,.05)",
    });

    css(label, {
      background: "#7f22fe",
    });

    // Clear previous contents
    while (label.firstChild) {
      label.removeChild(label.firstChild);
    }

    if (isSelected) {
      const editLine = document.createElement("div");

      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("width", "12");
      svg.setAttribute("height", "12");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("fill", "none");
      Object.assign(svg.style, {
        display: "inline-block",
        verticalAlign: "-2px",
        marginRight: "4px",
      });
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute(
        "d",
        "M8 0L9.48528 6.51472L16 8L9.48528 9.48528L8 16L6.51472 9.48528L0 8L6.51472 6.51472L8 0Z",
      );
      path.setAttribute("fill", "white");
      svg.appendChild(path);

      editLine.appendChild(svg);
      editLine.appendChild(document.createTextNode("Edit with AI"));
      label.appendChild(editLine);
    }

    const name = el.dataset.dyadName || "<unknown>";
    const file = (el.dataset.dyadId || "").split(":")[0];

    const nameEl = document.createElement("div");
    nameEl.textContent = name;
    label.appendChild(nameEl);

    if (file) {
      const fileEl = document.createElement("span");
      css(fileEl, { fontSize: "10px", opacity: ".8" });
      fileEl.textContent = file;
      label.appendChild(fileEl);
    }
  }

  /* ---------- event handlers -------------------------------------------- */
  function onMouseMove(e) {
    if (state.type !== "inspecting") return;

    let el = e.target;
    while (el && !el.dataset.dyadId) el = el.parentElement;

    if (state.element === el) return;
    state.element = el;

    if (el) {
      updateOverlay(el, false);
    } else {
      if (overlay) overlay.style.display = "none";
    }
  }

  function onClick(e) {
    if (state.type !== "inspecting" || !state.element) return;
    e.preventDefault();
    e.stopPropagation();

    state = { type: "selected", element: state.element };
    updateOverlay(state.element, true);

    window.parent.postMessage(
      {
        type: "dyad-component-selected",
        id: state.element.dataset.dyadId,
        name: state.element.dataset.dyadName,
      },
      "*",
    );
  }

  function onKeyDown(e) {
    // Ignore keystrokes if the user is typing in an input field, textarea, or editable element
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.isContentEditable
    ) {
      return;
    }

    // Forward shortcuts to parent window
    const key = e.key.toLowerCase();
    const hasShift = e.shiftKey;
    const hasCtrlOrMeta = isMac ? e.metaKey : e.ctrlKey;
    if (key === "c" && hasShift && hasCtrlOrMeta) {
      e.preventDefault();
      window.parent.postMessage(
        {
          type: "dyad-select-component-shortcut",
        },
        "*",
      );
    }
  }

  /* ---------- activation / deactivation --------------------------------- */
  function activate() {
    if (state.type === "inactive") {
      window.addEventListener("mousemove", onMouseMove, true);
      window.addEventListener("click", onClick, true);
    }
    state = { type: "inspecting", element: null };
    if (overlay) {
      overlay.style.display = "none";
    }
  }

  function deactivate() {
    if (state.type === "inactive") return;

    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("click", onClick, true);
    if (overlay) {
      overlay.remove();
      overlay = null;
      label = null;
    }
    state = { type: "inactive" };
  }

  /* ---------- message bridge -------------------------------------------- */
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    if (e.data.type === "activate-dyad-component-selector") activate();
    if (e.data.type === "deactivate-dyad-component-selector") deactivate();
  });

  // Always listen for keyboard shortcuts
  window.addEventListener("keydown", onKeyDown, true);

  function initializeComponentSelector() {
    if (!document.body) {
      console.error(
        "Dyad component selector initialization failed: document.body not found.",
      );
      return;
    }
    setTimeout(() => {
      if (document.body.querySelector("[data-dyad-id]")) {
        window.parent.postMessage(
          {
            type: "dyad-component-selector-initialized",
          },
          "*",
        );
        console.debug("Dyad component selector initialized");
      } else {
        console.warn(
          "Dyad component selector not initialized because no DOM elements were tagged",
        );
      }
    }, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeComponentSelector);
  } else {
    initializeComponentSelector();
  }
})();
