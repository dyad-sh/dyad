(() => {
  /* ---------- helpers --------------------------------------------------- */

  function findElementByDyadId(dyadId) {
    const escaped = CSS.escape(dyadId);
    const element = document.querySelector(`[data-dyad-id="${escaped}"]`);

    if (!element) {
      console.warn(
        `[Dyad Visual Editor] Element not found. Available elements with data-dyad-id:`,
        Array.from(document.querySelectorAll("[data-dyad-id]")).map((el) =>
          el.getAttribute("data-dyad-id"),
        ),
      );
    } else {
      console.debug(`[Dyad Visual Editor] Found element:`, element);
    }

    return element;
  }

  function applyStyles(element, styles) {
    if (!element || !styles) return;

    console.debug(
      `[Dyad Visual Editor] Applying styles:`,
      styles,
      "to element:",
      element,
    );

    // Apply margin
    if (styles.margin) {
      Object.entries(styles.margin).forEach(([side, value]) => {
        const cssProperty = `margin${side.charAt(0).toUpperCase() + side.slice(1)}`;
        element.style[cssProperty] = value;
      });
    }

    // Apply padding
    if (styles.padding) {
      Object.entries(styles.padding).forEach(([side, value]) => {
        const cssProperty = `padding${side.charAt(0).toUpperCase() + side.slice(1)}`;
        element.style[cssProperty] = value;
      });
    }

    // Apply dimensions
    if (styles.dimensions) {
      if (styles.dimensions.width !== undefined) {
        element.style.width = styles.dimensions.width;
      }
      if (styles.dimensions.height !== undefined) {
        element.style.height = styles.dimensions.height;
      }
    }
  }

  /* ---------- message handlers ------------------------------------------ */

  function handleGetStyles(data) {
    const { elementId } = data;
    const element = findElementByDyadId(elementId);
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
        dimensions: {
          width: computedStyle.width,
          height: computedStyle.height,
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
    const { elementId, styles } = data;
    const element = findElementByDyadId(elementId);
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
    }
  });
})();
