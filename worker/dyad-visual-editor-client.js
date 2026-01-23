(() => {
  /* ---------- helpers --------------------------------------------------- */

  // Track text editing state globally
  let textEditingState = new Map(); // componentId -> { originalText, currentText, cleanup }

  function findElementByDyadId(dyadId, runtimeId) {
    // If runtimeId is provided, try to find element by runtime ID first
    if (runtimeId) {
      const elementByRuntimeId = document.querySelector(
        `[data-dyad-runtime-id="${runtimeId}"]`,
      );
      if (elementByRuntimeId) {
        return elementByRuntimeId;
      }
    }

    // Fall back to finding by dyad-id (will get first match)
    const escaped = CSS.escape(dyadId);
    return document.querySelector(`[data-dyad-id="${escaped}"]`);
  }

  function applyStyles(element, styles) {
    if (!element || !styles) return;

    console.debug(
      `[Dyad Visual Editor] Applying styles:`,
      styles,
      "to element:",
      element,
    );

    const applySpacing = (type, values) => {
      if (!values) return;
      Object.entries(values).forEach(([side, value]) => {
        const cssProperty = `${type}${side.charAt(0).toUpperCase() + side.slice(1)}`;
        element.style[cssProperty] = value;
      });
    };

    applySpacing("margin", styles.margin);
    applySpacing("padding", styles.padding);

    if (styles.border) {
      if (styles.border.width !== undefined) {
        element.style.borderWidth = styles.border.width;
        element.style.borderStyle = "solid";
      }
      if (styles.border.radius !== undefined) {
        element.style.borderRadius = styles.border.radius;
      }
      if (styles.border.color !== undefined) {
        element.style.borderColor = styles.border.color;
      }
    }

    if (styles.backgroundColor !== undefined) {
      element.style.backgroundColor = styles.backgroundColor;
    }

    if (styles.text) {
      const textProps = {
        fontSize: "fontSize",
        fontWeight: "fontWeight",
        fontFamily: "fontFamily",
        color: "color",
      };
      Object.entries(textProps).forEach(([key, cssProp]) => {
        if (styles.text[key] !== undefined) {
          element.style[cssProp] = styles.text[key];
        }
      });
    }
  }

  /* ---------- message handlers ------------------------------------------ */

  function handleGetStyles(data) {
    const { elementId, runtimeId } = data;
    const element = findElementByDyadId(elementId, runtimeId);
    if (element) {
      const computedStyle = window.getComputedStyle(element);
      const styles = {
        margin: {
          top: computedStyle.marginTop,
          right: computedStyle.marginRight,
          bottom: computedStyle.marginBottom,
          left: computedStyle.marginLeft,
        },
        padding: {
          top: computedStyle.paddingTop,
          right: computedStyle.paddingRight,
          bottom: computedStyle.paddingBottom,
          left: computedStyle.paddingLeft,
        },
        border: {
          width: computedStyle.borderWidth,
          radius: computedStyle.borderRadius,
          color: computedStyle.borderColor,
        },
        backgroundColor: computedStyle.backgroundColor,
        text: {
          fontSize: computedStyle.fontSize,
          fontWeight: computedStyle.fontWeight,
          fontFamily: computedStyle.fontFamily,
          color: computedStyle.color,
        },
      };

      window.parent.postMessage(
        {
          type: "dyad-component-styles",
          data: styles,
        },
        "*",
      );
    }
  }

  function handleModifyStyles(data) {
    const { elementId, runtimeId, styles } = data;
    const element = findElementByDyadId(elementId, runtimeId);
    if (element) {
      applyStyles(element, styles);

      // Send updated coordinates after style change

      const rect = element.getBoundingClientRect();
      window.parent.postMessage(
        {
          type: "dyad-component-coordinates-updated",
          coordinates: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
        },
        "*",
      );
    }
  }

  function handleEnableTextEditing(data) {
    const { componentId, runtimeId } = data;

    // Clean up any existing text editing states first
    textEditingState.forEach((state, existingId) => {
      if (existingId !== componentId) {
        state.cleanup();
      }
    });

    const element = findElementByDyadId(componentId, runtimeId);
    if (element) {
      const originalText = element.innerText;

      element.contentEditable = "true";
      element.focus();

      // Select all text
      const range = document.createRange();
      range.selectNodeContents(element);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      // Send updates as user types
      const onInput = () => {
        const currentText = element.innerText;

        // Update tracked state
        const state = textEditingState.get(componentId);
        if (state) {
          state.currentText = currentText;
        }

        window.parent.postMessage(
          {
            type: "dyad-text-updated",
            componentId,
            text: currentText,
          },
          "*",
        );
      };

      element.addEventListener("input", onInput);

      // Prevent click from propagating to selector while editing
      const stopProp = (e) => e.stopPropagation();
      element.addEventListener("click", stopProp);

      // Cleanup function
      const cleanup = () => {
        element.contentEditable = "false";
        element.removeEventListener("input", onInput);
        element.removeEventListener("click", stopProp);

        // Send final text update
        const finalText = element.innerText;
        window.parent.postMessage(
          {
            type: "dyad-text-finalized",
            componentId,
            text: finalText,
          },
          "*",
        );

        textEditingState.delete(componentId);
      };

      // Store state
      textEditingState.set(componentId, {
        originalText,
        currentText: originalText,
        cleanup,
      });
    }
  }

  function handleDisableTextEditing(data) {
    const { componentId } = data;
    const state = textEditingState.get(componentId);
    if (state) {
      state.cleanup();
    }
  }

  function handleGetTextContent(data) {
    const { componentId, runtimeId } = data;
    const element = findElementByDyadId(componentId, runtimeId);
    const state = textEditingState.get(componentId);

    window.parent.postMessage(
      {
        type: "dyad-text-content-response",
        componentId,
        text: state ? state.currentText : element ? element.innerText : null,
        isEditing: !!state,
      },
      "*",
    );
  }

  /* ---------- message bridge -------------------------------------------- */

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;

    const { type, data } = e.data;

    switch (type) {
      case "get-dyad-component-styles":
        handleGetStyles(data);
        break;
      case "modify-dyad-component-styles":
        handleModifyStyles(data);
        break;
      case "enable-dyad-text-editing":
        handleEnableTextEditing(data);
        break;
      case "disable-dyad-text-editing":
        handleDisableTextEditing(data);
        break;
      case "get-dyad-text-content":
        handleGetTextContent(data);
        break;
      case "cleanup-all-text-editing":
        // Clean up all text editing states
        textEditingState.forEach((state) => {
          state.cleanup();
        });
        break;
    }
  });
})();
