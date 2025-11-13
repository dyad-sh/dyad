(() => {
  const OVERLAY_CLASS = "__dyad_overlay__";
  let overlays = [];
  let hoverOverlay = null;
  let hoverLabel = null;
  let currentHoveredElement = null;
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
    const overlay = document.createElement("div");
    overlay.className = OVERLAY_CLASS;
    css(overlay, {
      position: "absolute",
      border: "2px solid #7f22fe",
      background: "rgba(0,170,255,.05)",
      pointerEvents: "none",
      zIndex: "2147483647", // max
      borderRadius: "4px",
      boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
    });

    const label = document.createElement("div");
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

    return { overlay, label };
  }

  function updateOverlay(el, isSelected = false) {
    // If no element, hide hover overlay
    if (!el) {
      if (hoverOverlay) hoverOverlay.style.display = "none";
      return;
    }

    if (isSelected) {
      if (overlays.some((item) => item.el === el)) {
        return;
      }

      const { overlay, label } = makeOverlay();
      overlays.push({ overlay, label, el });

      const rect = el.getBoundingClientRect();
      css(overlay, {
        top: `${rect.top + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        display: "block",
        border: "3px solid #7f22fe",
        background: "rgba(127, 34, 254, 0.05)",
      });

      css(label, { display: "none" });

      return;
    }

    // Otherwise, this is a hover overlay: reuse the hover overlay node
    if (!hoverOverlay || !hoverLabel) {
      const o = makeOverlay();
      hoverOverlay = o.overlay;
      hoverLabel = o.label;
    }

    const rect = el.getBoundingClientRect();
    css(hoverOverlay, {
      top: `${rect.top + window.scrollY}px`,
      left: `${rect.left + window.scrollX}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      display: "block",
      border: "2px solid #7f22fe",
      background: "rgba(0,170,255,.05)",
    });
    css(hoverLabel, { background: "#7f22fe" });
    while (hoverLabel.firstChild) hoverLabel.removeChild(hoverLabel.firstChild);
    const name = el.dataset.dyadName || "<unknown>";
    const file = (el.dataset.dyadId || "").split(":")[0];
    const nameEl = document.createElement("div");
    nameEl.textContent = name;
    hoverLabel.appendChild(nameEl);
    if (file) {
      const fileEl = document.createElement("span");
      css(fileEl, { fontSize: "10px", opacity: ".8" });
      fileEl.textContent = file.replace(/\\/g, "/");
      hoverLabel.appendChild(fileEl);
    }

    // Update positions after showing hover label in case it caused layout shift
    requestAnimationFrame(updateAllOverlayPositions);
  }

  function updateAllOverlayPositions() {
    // Update all selected overlays
    overlays.forEach(({ overlay, el }) => {
      const rect = el.getBoundingClientRect();
      css(overlay, {
        top: `${rect.top + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    });

    // Update hover overlay if visible
    if (
      hoverOverlay &&
      hoverOverlay.style.display !== "none" &&
      state.element
    ) {
      const rect = state.element.getBoundingClientRect();
      css(hoverOverlay, {
        top: `${rect.top + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }
  }

  function clearOverlays() {
    overlays.forEach(({ overlay }) => overlay.remove());
    overlays = [];

    if (hoverOverlay) {
      hoverOverlay.remove();
      hoverOverlay = null;
      hoverLabel = null;
    }

    currentHoveredElement = null;
  }

  function removeOverlayById(componentId) {
    const index = overlays.findIndex(
      ({ el }) => el.dataset.dyadId === componentId,
    );
    if (index !== -1) {
      const { overlay } = overlays[index];
      overlay.remove();
      overlays.splice(index, 1);
    }
  }

  // Helper function to show/hide and populate label for a selected overlay
  function updateSelectedOverlayLabel(item, show) {
    const { label, el } = item;

    if (!show) {
      css(label, { display: "none" });
      // Update positions after hiding label in case it caused layout shift
      requestAnimationFrame(updateAllOverlayPositions);
      return;
    }

    // Clear and populate label
    css(label, { display: "block", background: "#7f22fe" });
    while (label.firstChild) label.removeChild(label.firstChild);

    // Add "Edit with AI" line
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

    // Add component name and file
    const name = el.dataset.dyadName || "<unknown>";
    const file = (el.dataset.dyadId || "").split(":")[0];
    const nameEl = document.createElement("div");
    nameEl.textContent = name;
    label.appendChild(nameEl);
    if (file) {
      const fileEl = document.createElement("span");
      css(fileEl, { fontSize: "10px", opacity: ".8" });
      fileEl.textContent = file.replace(/\\/g, "/");
      label.appendChild(fileEl);
    }

    // Update positions after showing label in case it caused layout shift
    requestAnimationFrame(updateAllOverlayPositions);
  }

  /* ---------- event handlers -------------------------------------------- */
  function onMouseMove(e) {
    let el = e.target;
    while (el && !el.dataset.dyadId) el = el.parentElement;

    const hoveredItem = overlays.find((item) => item.el === el);

    if (currentHoveredElement && currentHoveredElement !== el) {
      const previousItem = overlays.find(
        (item) => item.el === currentHoveredElement,
      );
      if (previousItem) {
        updateSelectedOverlayLabel(previousItem, false);
      }
    }

    currentHoveredElement = el;

    // If hovering over a selected component, show its label
    if (hoveredItem) {
      updateSelectedOverlayLabel(hoveredItem, true);
      if (hoverOverlay) hoverOverlay.style.display = "none";
    }

    // Handle inspecting state (component selector is active)
    if (state.type === "inspecting") {
      if (state.element === el) return;
      state.element = el;

      if (!hoveredItem && el) {
        updateOverlay(el, false);
      } else if (!el) {
        if (hoverOverlay) hoverOverlay.style.display = "none";
      }
    }
  }

  function onMouseLeave(e) {
    if (!e.relatedTarget) {
      if (hoverOverlay) {
        hoverOverlay.style.display = "none";
        requestAnimationFrame(updateAllOverlayPositions);
      }
      currentHoveredElement = null;
      if (state.type === "inspecting") {
        state.element = null;
      }
    }
  }

  function onClick(e) {
    if (state.type !== "inspecting" || !state.element) return;
    e.preventDefault();
    e.stopPropagation();

    const selectedItem = overlays.find((item) => item.el === e.target);
    if (selectedItem) {
      removeOverlayById(state.element.dataset.dyadId);
      window.parent.postMessage(
        {
          type: "dyad-component-deselected",
          componentId: state.element.dataset.dyadId,
        },
        "*",
      );
      return;
    }

    updateOverlay(state.element, true);

    requestAnimationFrame(updateAllOverlayPositions);

    window.parent.postMessage(
      {
        type: "dyad-component-selected",
        component: {
          id: state.element.dataset.dyadId,
          name: state.element.dataset.dyadName,
        },
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
      window.addEventListener("click", onClick, true);
    }
    state = { type: "inspecting", element: null };
  }

  function deactivate() {
    if (state.type === "inactive") return;

    window.removeEventListener("click", onClick, true);
    // Don't clear overlays on deactivate - keep selected components visible
    // Hide only the hover overlay and all labels
    if (hoverOverlay) {
      hoverOverlay.style.display = "none";
    }

    // Hide all labels when deactivating
    overlays.forEach((item) => updateSelectedOverlayLabel(item, false));
    currentHoveredElement = null;

    state = { type: "inactive" };
  }

  /* ---------- message bridge -------------------------------------------- */
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    if (e.data.type === "activate-dyad-component-selector") activate();
    if (e.data.type === "deactivate-dyad-component-selector") deactivate();
    if (e.data.type === "clear-dyad-component-overlays") clearOverlays();
    if (e.data.type === "remove-dyad-component-overlay") {
      if (e.data.componentId) {
        removeOverlayById(e.data.componentId);
      }
    }
  });

  // Always listen for keyboard shortcuts
  window.addEventListener("keydown", onKeyDown, true);

  // Always listen for mouse move to show/hide labels on selected overlays
  window.addEventListener("mousemove", onMouseMove, true);

  document.addEventListener("mouseleave", onMouseLeave, true);

  // Update overlay positions on window resize
  window.addEventListener("resize", updateAllOverlayPositions);

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
