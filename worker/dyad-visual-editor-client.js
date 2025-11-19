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

  function applyStyle(element, property, value) {
    if (!element || !property) return;

    console.debug(
      `[Dyad Visual Editor] Applying ${property}:`,
      value,
      "to element:",
      element,
    );

    if (typeof value === "object") {
      const sides = ["top", "right", "bottom", "left"];
      sides.forEach((side) => {
        if (value[side] !== undefined) {
          const cssProperty =
            property === "margin"
              ? `margin${side.charAt(0).toUpperCase() + side.slice(1)}`
              : property === "padding"
                ? `padding${side.charAt(0).toUpperCase() + side.slice(1)}`
                : "";
          if (cssProperty) {
            element.style[cssProperty] = value[side];
          }
        }
      });
    } else {
      const cssProperty =
        property === "width" ? "width" : property === "height" ? "height" : "";

      if (cssProperty) {
        element.style[cssProperty] = value;
      }
    }
  }

  /* ---------- message handlers ------------------------------------------ */

  function handleGetStyles(data) {
    const { elementId } = data;
    const element = findElementByDyadId(elementId);
    if (element) {
      const computedStyle = window.getComputedStyle(element);
      const margin = {
        top: computedStyle.marginTop,
        right: computedStyle.marginRight,
        bottom: computedStyle.marginBottom,
        left: computedStyle.marginLeft,
      };
      const padding = {
        top: computedStyle.paddingTop,
        right: computedStyle.paddingRight,
        bottom: computedStyle.paddingBottom,
        left: computedStyle.paddingLeft,
      };
      const dimensions = {
        width: computedStyle.width,
        height: computedStyle.height,
      };

      window.parent.postMessage(
        {
          type: "dyad-component-styles",
          data: { margin, padding, dimensions },
        },
        "*",
      );
    }
  }

  function handleModifyMargin(data) {
    const { elementId, margin } = data;
    console.log("margin");
    console.log(elementId);
    const element = findElementByDyadId(elementId);
    console.log("element", element);
    if (element) {
      console.log("element found");
      applyStyle(element, "margin", margin);
    }
  }

  function handleModifyPadding(data) {
    const { elementId, padding } = data;
    const element = findElementByDyadId(elementId);
    if (element) {
      applyStyle(element, "padding", padding);
    }
  }

  function handleModifyDimension(data) {
    const { elementId, dimensions } = data;
    const element = findElementByDyadId(elementId);
    if (element) {
      if (dimensions.width !== undefined) {
        applyStyle(element, "width", dimensions.width);
      }
      if (dimensions.height !== undefined) {
        applyStyle(element, "height", dimensions.height);
      }
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
      case "modify-dyad-component-margin":
        handleModifyMargin(data);
        break;
      case "modify-dyad-component-padding":
        handleModifyPadding(data);
        break;
      case "modify-dyad-component-dimension":
        handleModifyDimension(data);
        break;
    }
  });
})();
