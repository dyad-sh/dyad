// Style conversion and manipulation utilities

interface SpacingValues {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
}

interface StyleObject {
  margin?: Record<string, string>;
  padding?: Record<string, string>;
  border?: Record<string, string>;
  backgroundColor?: string;
  text?: Record<string, string>;
}

/**
 * Convert spacing values (margin/padding) to Tailwind classes
 */
function convertSpacingToTailwind(
  values: SpacingValues,
  prefix: "m" | "p",
): string[] {
  const classes: string[] = [];
  const { left, right, top, bottom } = values;

  const hasHorizontal = left !== undefined && right !== undefined;
  const hasVertical = top !== undefined && bottom !== undefined;

  // All sides equal
  if (
    hasHorizontal &&
    hasVertical &&
    left === right &&
    top === bottom &&
    left === top
  ) {
    classes.push(`${prefix}-[${left}]`);
  } else {
    // Horizontal
    if (hasHorizontal && left === right) {
      classes.push(`${prefix}x-[${left}]`);
    } else {
      if (left !== undefined) classes.push(`${prefix}l-[${left}]`);
      if (right !== undefined) classes.push(`${prefix}r-[${right}]`);
    }

    // Vertical
    if (hasVertical && top === bottom) {
      classes.push(`${prefix}y-[${top}]`);
    } else {
      if (top !== undefined) classes.push(`${prefix}t-[${top}]`);
      if (bottom !== undefined) classes.push(`${prefix}b-[${bottom}]`);
    }
  }

  return classes;
}

/**
 * Convert style object to Tailwind classes
 */
export function stylesToTailwind(styles: StyleObject): string[] {
  const classes: string[] = [];

  if (styles.margin) {
    classes.push(...convertSpacingToTailwind(styles.margin, "m"));
  }

  if (styles.padding) {
    classes.push(...convertSpacingToTailwind(styles.padding, "p"));
  }

  if (styles.border) {
    if (styles.border.width !== undefined)
      classes.push(`border-[${styles.border.width}]`);
    if (styles.border.radius !== undefined)
      classes.push(`rounded-[${styles.border.radius}]`);
    if (styles.border.color !== undefined)
      classes.push(`border-[${styles.border.color}]`);
  }

  if (styles.backgroundColor !== undefined) {
    classes.push(`bg-[${styles.backgroundColor}]`);
  }

  if (styles.text) {
    if (styles.text.fontSize !== undefined)
      classes.push(`text-[${styles.text.fontSize}]`);
    if (styles.text.fontWeight !== undefined)
      classes.push(`font-[${styles.text.fontWeight}]`);
    if (styles.text.color !== undefined)
      classes.push(`[color:${styles.text.color}]`);
  }

  return classes;
}

/**
 * Convert RGB color to hex format
 */
export function rgbToHex(rgb: string): string {
  if (!rgb || rgb.startsWith("#")) return rgb || "#000000";
  const rgbMatch = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, "0");
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, "0");
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return rgb || "#000000";
}

/**
 * Process value by adding px suffix if it's a plain number
 */
export function processNumericValue(value: string): string {
  return /^\d+$/.test(value) ? `${value}px` : value;
}

/**
 * Extract prefixes from Tailwind classes
 */
export function extractClassPrefixes(classes: string[]): string[] {
  return Array.from(
    new Set(
      classes.map((cls) => {
        const match = cls.match(/^([a-z]+-)/);
        return match ? match[1] : cls.split("-")[0] + "-";
      }),
    ),
  );
}
