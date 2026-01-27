/**
 * Design System Generator
 * Auto-generate component libraries from prompts or existing designs
 */

import { randomUUID } from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { EventEmitter } from "node:events";

// =============================================================================
// TYPES
// =============================================================================

export type DesignSystemId = string & { __brand: "DesignSystemId" };
export type ComponentId = string & { __brand: "ComponentId" };
export type TokenId = string & { __brand: "TokenId" };

export type DesignSystemStatus = "draft" | "generating" | "ready" | "error";
export type ComponentType = "button" | "input" | "card" | "modal" | "table" | "navigation" | "layout" | "form" | "display" | "feedback" | "custom";
export type StyleFramework = "tailwind" | "css" | "scss" | "styled-components" | "emotion" | "vanilla-extract";
export type ComponentFramework = "react" | "vue" | "svelte" | "solid" | "angular" | "web-components";

export interface DesignSystem {
  id: DesignSystemId;
  name: string;
  description: string;
  status: DesignSystemStatus;
  config: DesignSystemConfig;
  tokens: DesignTokens;
  components: Component[];
  createdAt: number;
  updatedAt: number;
  exportedAt?: number;
  error?: string;
}

export interface DesignSystemConfig {
  styleFramework: StyleFramework;
  componentFramework: ComponentFramework;
  typescript: boolean;
  darkMode: boolean;
  responsive: boolean;
  accessibility: boolean;
  storybook: boolean;
  testing: boolean;
  outputDir?: string;
}

export interface DesignTokens {
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  borderRadius: RadiusTokens;
  shadows: ShadowTokens;
  transitions: TransitionTokens;
  breakpoints: BreakpointTokens;
}

export interface ColorTokens {
  primary: ColorScale;
  secondary: ColorScale;
  accent: ColorScale;
  neutral: ColorScale;
  success: ColorScale;
  warning: ColorScale;
  error: ColorScale;
  info: ColorScale;
  background: {
    default: string;
    paper: string;
    elevated: string;
  };
  text: {
    primary: string;
    secondary: string;
    disabled: string;
    inverse: string;
  };
  border: {
    default: string;
    focus: string;
    error: string;
  };
}

export interface ColorScale {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
}

export interface TypographyTokens {
  fontFamilies: {
    sans: string;
    serif: string;
    mono: string;
  };
  fontSizes: {
    xs: string;
    sm: string;
    base: string;
    lg: string;
    xl: string;
    "2xl": string;
    "3xl": string;
    "4xl": string;
    "5xl": string;
  };
  fontWeights: {
    light: number;
    normal: number;
    medium: number;
    semibold: number;
    bold: number;
  };
  lineHeights: {
    tight: string;
    normal: string;
    relaxed: string;
  };
  letterSpacings: {
    tight: string;
    normal: string;
    wide: string;
  };
}

export interface SpacingTokens {
  "0": string;
  "1": string;
  "2": string;
  "3": string;
  "4": string;
  "5": string;
  "6": string;
  "8": string;
  "10": string;
  "12": string;
  "16": string;
  "20": string;
  "24": string;
}

export interface RadiusTokens {
  none: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
  full: string;
}

export interface ShadowTokens {
  none: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
  inner: string;
}

export interface TransitionTokens {
  fast: string;
  normal: string;
  slow: string;
  easings: {
    easeIn: string;
    easeOut: string;
    easeInOut: string;
  };
}

export interface BreakpointTokens {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
}

export interface Component {
  id: ComponentId;
  name: string;
  type: ComponentType;
  description: string;
  variants: ComponentVariant[];
  props: ComponentProp[];
  slots?: ComponentSlot[];
  styles: string;
  code: string;
  storybook?: string;
  tests?: string;
  docs?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ComponentVariant {
  name: string;
  props: Record<string, any>;
  preview?: string;
}

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  default?: any;
  description: string;
  options?: string[];
}

export interface ComponentSlot {
  name: string;
  description: string;
  required: boolean;
}

export interface GenerateSystemParams {
  name: string;
  description: string;
  prompt?: string;
  brandColors?: { primary: string; secondary?: string; accent?: string };
  referenceImages?: string[];
  existingTokens?: Partial<DesignTokens>;
  config: DesignSystemConfig;
}

export interface GenerateComponentParams {
  systemId: DesignSystemId;
  type: ComponentType;
  name: string;
  description: string;
  prompt?: string;
  variants?: string[];
  referenceImage?: string;
}

export interface ExportOptions {
  outputDir: string;
  includeStorybook: boolean;
  includeTests: boolean;
  includeDocs: boolean;
  format: "individual" | "monorepo" | "package";
}

export type DesignSystemEventType =
  | "system:created"
  | "system:updated"
  | "system:deleted"
  | "system:generating"
  | "system:ready"
  | "system:error"
  | "component:created"
  | "component:updated"
  | "component:deleted"
  | "tokens:updated"
  | "export:started"
  | "export:progress"
  | "export:completed"
  | "export:error";

export interface DesignSystemEvent {
  type: DesignSystemEventType;
  systemId: DesignSystemId;
  componentId?: ComponentId;
  data?: any;
}

// =============================================================================
// DEFAULT TOKENS
// =============================================================================

export const DEFAULT_TOKENS: DesignTokens = {
  colors: {
    primary: {
      50: "#eff6ff",
      100: "#dbeafe",
      200: "#bfdbfe",
      300: "#93c5fd",
      400: "#60a5fa",
      500: "#3b82f6",
      600: "#2563eb",
      700: "#1d4ed8",
      800: "#1e40af",
      900: "#1e3a8a",
    },
    secondary: {
      50: "#f8fafc",
      100: "#f1f5f9",
      200: "#e2e8f0",
      300: "#cbd5e1",
      400: "#94a3b8",
      500: "#64748b",
      600: "#475569",
      700: "#334155",
      800: "#1e293b",
      900: "#0f172a",
    },
    accent: {
      50: "#fdf4ff",
      100: "#fae8ff",
      200: "#f5d0fe",
      300: "#f0abfc",
      400: "#e879f9",
      500: "#d946ef",
      600: "#c026d3",
      700: "#a21caf",
      800: "#86198f",
      900: "#701a75",
    },
    neutral: {
      50: "#fafafa",
      100: "#f5f5f5",
      200: "#e5e5e5",
      300: "#d4d4d4",
      400: "#a3a3a3",
      500: "#737373",
      600: "#525252",
      700: "#404040",
      800: "#262626",
      900: "#171717",
    },
    success: {
      50: "#f0fdf4",
      100: "#dcfce7",
      200: "#bbf7d0",
      300: "#86efac",
      400: "#4ade80",
      500: "#22c55e",
      600: "#16a34a",
      700: "#15803d",
      800: "#166534",
      900: "#14532d",
    },
    warning: {
      50: "#fffbeb",
      100: "#fef3c7",
      200: "#fde68a",
      300: "#fcd34d",
      400: "#fbbf24",
      500: "#f59e0b",
      600: "#d97706",
      700: "#b45309",
      800: "#92400e",
      900: "#78350f",
    },
    error: {
      50: "#fef2f2",
      100: "#fee2e2",
      200: "#fecaca",
      300: "#fca5a5",
      400: "#f87171",
      500: "#ef4444",
      600: "#dc2626",
      700: "#b91c1c",
      800: "#991b1b",
      900: "#7f1d1d",
    },
    info: {
      50: "#ecfeff",
      100: "#cffafe",
      200: "#a5f3fc",
      300: "#67e8f9",
      400: "#22d3ee",
      500: "#06b6d4",
      600: "#0891b2",
      700: "#0e7490",
      800: "#155e75",
      900: "#164e63",
    },
    background: {
      default: "#ffffff",
      paper: "#f9fafb",
      elevated: "#ffffff",
    },
    text: {
      primary: "#111827",
      secondary: "#6b7280",
      disabled: "#9ca3af",
      inverse: "#ffffff",
    },
    border: {
      default: "#e5e7eb",
      focus: "#3b82f6",
      error: "#ef4444",
    },
  },
  typography: {
    fontFamilies: {
      sans: "Inter, system-ui, -apple-system, sans-serif",
      serif: "Georgia, Cambria, serif",
      mono: "Menlo, Monaco, Consolas, monospace",
    },
    fontSizes: {
      xs: "0.75rem",
      sm: "0.875rem",
      base: "1rem",
      lg: "1.125rem",
      xl: "1.25rem",
      "2xl": "1.5rem",
      "3xl": "1.875rem",
      "4xl": "2.25rem",
      "5xl": "3rem",
    },
    fontWeights: {
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeights: {
      tight: "1.25",
      normal: "1.5",
      relaxed: "1.75",
    },
    letterSpacings: {
      tight: "-0.025em",
      normal: "0em",
      wide: "0.025em",
    },
  },
  spacing: {
    "0": "0px",
    "1": "0.25rem",
    "2": "0.5rem",
    "3": "0.75rem",
    "4": "1rem",
    "5": "1.25rem",
    "6": "1.5rem",
    "8": "2rem",
    "10": "2.5rem",
    "12": "3rem",
    "16": "4rem",
    "20": "5rem",
    "24": "6rem",
  },
  borderRadius: {
    none: "0px",
    sm: "0.125rem",
    md: "0.375rem",
    lg: "0.5rem",
    xl: "0.75rem",
    "2xl": "1rem",
    full: "9999px",
  },
  shadows: {
    none: "none",
    sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
    lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
    xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
    "2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
    inner: "inset 0 2px 4px 0 rgb(0 0 0 / 0.05)",
  },
  transitions: {
    fast: "150ms",
    normal: "200ms",
    slow: "300ms",
    easings: {
      easeIn: "cubic-bezier(0.4, 0, 1, 1)",
      easeOut: "cubic-bezier(0, 0, 0.2, 1)",
      easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
    },
  },
  breakpoints: {
    sm: "640px",
    md: "768px",
    lg: "1024px",
    xl: "1280px",
    "2xl": "1536px",
  },
};

// =============================================================================
// COMPONENT TEMPLATES
// =============================================================================

const COMPONENT_TEMPLATES: Record<ComponentType, { name: string; props: ComponentProp[]; variants: string[] }> = {
  button: {
    name: "Button",
    props: [
      { name: "variant", type: "string", required: false, default: "primary", description: "Button variant", options: ["primary", "secondary", "outline", "ghost", "destructive"] },
      { name: "size", type: "string", required: false, default: "md", description: "Button size", options: ["sm", "md", "lg"] },
      { name: "disabled", type: "boolean", required: false, default: false, description: "Disable button" },
      { name: "loading", type: "boolean", required: false, default: false, description: "Show loading state" },
      { name: "leftIcon", type: "ReactNode", required: false, description: "Icon on the left" },
      { name: "rightIcon", type: "ReactNode", required: false, description: "Icon on the right" },
    ],
    variants: ["primary", "secondary", "outline", "ghost", "destructive"],
  },
  input: {
    name: "Input",
    props: [
      { name: "type", type: "string", required: false, default: "text", description: "Input type" },
      { name: "placeholder", type: "string", required: false, description: "Placeholder text" },
      { name: "label", type: "string", required: false, description: "Input label" },
      { name: "error", type: "string", required: false, description: "Error message" },
      { name: "disabled", type: "boolean", required: false, default: false, description: "Disable input" },
      { name: "size", type: "string", required: false, default: "md", description: "Input size", options: ["sm", "md", "lg"] },
    ],
    variants: ["default", "filled", "flushed"],
  },
  card: {
    name: "Card",
    props: [
      { name: "variant", type: "string", required: false, default: "elevated", description: "Card variant", options: ["elevated", "outlined", "filled"] },
      { name: "padding", type: "string", required: false, default: "md", description: "Card padding", options: ["none", "sm", "md", "lg"] },
      { name: "interactive", type: "boolean", required: false, default: false, description: "Make card clickable" },
    ],
    variants: ["elevated", "outlined", "filled"],
  },
  modal: {
    name: "Modal",
    props: [
      { name: "open", type: "boolean", required: true, description: "Modal open state" },
      { name: "onClose", type: "function", required: true, description: "Close handler" },
      { name: "title", type: "string", required: false, description: "Modal title" },
      { name: "size", type: "string", required: false, default: "md", description: "Modal size", options: ["sm", "md", "lg", "xl", "full"] },
      { name: "closeOnOverlay", type: "boolean", required: false, default: true, description: "Close on overlay click" },
    ],
    variants: ["default", "centered", "drawer"],
  },
  table: {
    name: "Table",
    props: [
      { name: "data", type: "array", required: true, description: "Table data" },
      { name: "columns", type: "array", required: true, description: "Column definitions" },
      { name: "striped", type: "boolean", required: false, default: false, description: "Striped rows" },
      { name: "hoverable", type: "boolean", required: false, default: true, description: "Row hover effect" },
      { name: "sortable", type: "boolean", required: false, default: false, description: "Enable sorting" },
    ],
    variants: ["default", "striped", "compact"],
  },
  navigation: {
    name: "Navigation",
    props: [
      { name: "items", type: "array", required: true, description: "Navigation items" },
      { name: "orientation", type: "string", required: false, default: "horizontal", description: "Nav orientation", options: ["horizontal", "vertical"] },
      { name: "variant", type: "string", required: false, default: "default", description: "Nav variant", options: ["default", "pills", "underline"] },
    ],
    variants: ["default", "pills", "underline"],
  },
  layout: {
    name: "Layout",
    props: [
      { name: "variant", type: "string", required: false, default: "default", description: "Layout variant", options: ["default", "sidebar", "dashboard"] },
      { name: "sidebar", type: "ReactNode", required: false, description: "Sidebar content" },
      { name: "header", type: "ReactNode", required: false, description: "Header content" },
    ],
    variants: ["default", "sidebar", "dashboard"],
  },
  form: {
    name: "Form",
    props: [
      { name: "onSubmit", type: "function", required: true, description: "Submit handler" },
      { name: "layout", type: "string", required: false, default: "vertical", description: "Form layout", options: ["vertical", "horizontal", "inline"] },
      { name: "spacing", type: "string", required: false, default: "md", description: "Field spacing", options: ["sm", "md", "lg"] },
    ],
    variants: ["vertical", "horizontal", "inline"],
  },
  display: {
    name: "Display",
    props: [
      { name: "variant", type: "string", required: false, default: "text", description: "Display type", options: ["text", "badge", "avatar", "chip"] },
    ],
    variants: ["text", "badge", "avatar", "chip"],
  },
  feedback: {
    name: "Feedback",
    props: [
      { name: "variant", type: "string", required: false, default: "alert", description: "Feedback type", options: ["alert", "toast", "progress", "skeleton"] },
      { name: "status", type: "string", required: false, default: "info", description: "Status", options: ["info", "success", "warning", "error"] },
    ],
    variants: ["alert", "toast", "progress", "skeleton"],
  },
  custom: {
    name: "Custom",
    props: [],
    variants: ["default"],
  },
};

// =============================================================================
// DESIGN SYSTEM GENERATOR
// =============================================================================

export class DesignSystemGenerator extends EventEmitter {
  private systems: Map<DesignSystemId, DesignSystem> = new Map();
  private storageDir: string;

  constructor(storageDir?: string) {
    super();
    this.storageDir = storageDir || path.join(process.cwd(), ".design-systems");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
    await this.loadSystems();
  }

  // ---------------------------------------------------------------------------
  // SYSTEM MANAGEMENT
  // ---------------------------------------------------------------------------

  async createSystem(params: GenerateSystemParams): Promise<DesignSystem> {
    const systemId = randomUUID() as DesignSystemId;
    
    const system: DesignSystem = {
      id: systemId,
      name: params.name,
      description: params.description,
      status: "draft",
      config: params.config,
      tokens: this.generateTokens(params),
      components: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.systems.set(systemId, system);
    await this.saveSystem(system);
    this.emitEvent("system:created", systemId);

    return system;
  }

  async generateSystem(systemId: DesignSystemId): Promise<DesignSystem> {
    const system = this.systems.get(systemId);
    if (!system) throw new Error("Design system not found");

    system.status = "generating";
    this.emitEvent("system:generating", systemId);

    try {
      // Generate base components
      const baseComponents: ComponentType[] = ["button", "input", "card", "modal", "table"];
      
      for (const type of baseComponents) {
        const component = await this.generateComponent({
          systemId,
          type,
          name: COMPONENT_TEMPLATES[type].name,
          description: `Auto-generated ${type} component`,
        });
        system.components.push(component);
      }

      system.status = "ready";
      system.updatedAt = Date.now();
      await this.saveSystem(system);
      this.emitEvent("system:ready", systemId);
    } catch (error) {
      system.status = "error";
      system.error = String(error);
      await this.saveSystem(system);
      this.emitEvent("system:error", systemId, undefined, { error: String(error) });
    }

    return system;
  }

  async getSystem(systemId: DesignSystemId): Promise<DesignSystem | null> {
    return this.systems.get(systemId) || null;
  }

  async listSystems(): Promise<DesignSystem[]> {
    return Array.from(this.systems.values());
  }

  async deleteSystem(systemId: DesignSystemId): Promise<void> {
    this.systems.delete(systemId);
    const systemPath = path.join(this.storageDir, `${systemId}.json`);
    await fs.unlink(systemPath).catch(() => {});
    this.emitEvent("system:deleted", systemId);
  }

  async updateTokens(systemId: DesignSystemId, tokens: Partial<DesignTokens>): Promise<DesignSystem> {
    const system = this.systems.get(systemId);
    if (!system) throw new Error("Design system not found");

    system.tokens = { ...system.tokens, ...tokens };
    system.updatedAt = Date.now();
    await this.saveSystem(system);
    this.emitEvent("tokens:updated", systemId);

    return system;
  }

  // ---------------------------------------------------------------------------
  // COMPONENT GENERATION
  // ---------------------------------------------------------------------------

  async generateComponent(params: GenerateComponentParams): Promise<Component> {
    const system = this.systems.get(params.systemId);
    if (!system) throw new Error("Design system not found");

    const template = COMPONENT_TEMPLATES[params.type];
    const componentId = randomUUID() as ComponentId;

    const variants: ComponentVariant[] = (params.variants || template.variants).map((v) => ({
      name: v,
      props: { variant: v },
    }));

    const component: Component = {
      id: componentId,
      name: params.name,
      type: params.type,
      description: params.description,
      variants,
      props: template.props,
      styles: this.generateStyles(system, params.type),
      code: this.generateCode(system, params.type, params.name, template.props),
      storybook: system.config.storybook ? this.generateStorybook(params.name, variants, template.props) : undefined,
      tests: system.config.testing ? this.generateTests(params.name) : undefined,
      docs: this.generateDocs(params.name, params.description, template.props, variants),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Add to system if not already there
    const existing = system.components.findIndex((c) => c.id === componentId);
    if (existing >= 0) {
      system.components[existing] = component;
    } else {
      system.components.push(component);
    }

    system.updatedAt = Date.now();
    await this.saveSystem(system);
    this.emitEvent("component:created", params.systemId, componentId);

    return component;
  }

  async updateComponent(
    systemId: DesignSystemId,
    componentId: ComponentId,
    updates: Partial<Component>
  ): Promise<Component> {
    const system = this.systems.get(systemId);
    if (!system) throw new Error("Design system not found");

    const component = system.components.find((c) => c.id === componentId);
    if (!component) throw new Error("Component not found");

    Object.assign(component, updates, { updatedAt: Date.now() });
    system.updatedAt = Date.now();
    await this.saveSystem(system);
    this.emitEvent("component:updated", systemId, componentId);

    return component;
  }

  async deleteComponent(systemId: DesignSystemId, componentId: ComponentId): Promise<void> {
    const system = this.systems.get(systemId);
    if (!system) throw new Error("Design system not found");

    system.components = system.components.filter((c) => c.id !== componentId);
    system.updatedAt = Date.now();
    await this.saveSystem(system);
    this.emitEvent("component:deleted", systemId, componentId);
  }

  // ---------------------------------------------------------------------------
  // EXPORT
  // ---------------------------------------------------------------------------

  async exportSystem(systemId: DesignSystemId, options: ExportOptions): Promise<string> {
    const system = this.systems.get(systemId);
    if (!system) throw new Error("Design system not found");

    this.emitEvent("export:started", systemId);

    try {
      const outputDir = options.outputDir;
      await fs.mkdir(outputDir, { recursive: true });

      // Export tokens
      await this.exportTokens(system, outputDir);
      this.emitEvent("export:progress", systemId, undefined, { step: "tokens", progress: 20 });

      // Export components
      await this.exportComponents(system, outputDir);
      this.emitEvent("export:progress", systemId, undefined, { step: "components", progress: 50 });

      // Export storybook if enabled
      if (options.includeStorybook && system.config.storybook) {
        await this.exportStorybook(system, outputDir);
        this.emitEvent("export:progress", systemId, undefined, { step: "storybook", progress: 70 });
      }

      // Export tests if enabled
      if (options.includeTests && system.config.testing) {
        await this.exportTests(system, outputDir);
        this.emitEvent("export:progress", systemId, undefined, { step: "tests", progress: 85 });
      }

      // Export docs if enabled
      if (options.includeDocs) {
        await this.exportDocs(system, outputDir);
        this.emitEvent("export:progress", systemId, undefined, { step: "docs", progress: 95 });
      }

      // Create package.json
      await this.createPackageJson(system, outputDir);

      system.exportedAt = Date.now();
      await this.saveSystem(system);
      this.emitEvent("export:completed", systemId, undefined, { outputDir });

      return outputDir;
    } catch (error) {
      this.emitEvent("export:error", systemId, undefined, { error: String(error) });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // PRIVATE METHODS
  // ---------------------------------------------------------------------------

  private generateTokens(params: GenerateSystemParams): DesignTokens {
    const tokens = { ...DEFAULT_TOKENS };

    // Apply brand colors if provided
    if (params.brandColors?.primary) {
      tokens.colors.primary = this.generateColorScale(params.brandColors.primary);
    }
    if (params.brandColors?.secondary) {
      tokens.colors.secondary = this.generateColorScale(params.brandColors.secondary);
    }
    if (params.brandColors?.accent) {
      tokens.colors.accent = this.generateColorScale(params.brandColors.accent);
    }

    // Merge existing tokens if provided
    if (params.existingTokens) {
      return { ...tokens, ...params.existingTokens };
    }

    return tokens;
  }

  private generateColorScale(baseColor: string): ColorScale {
    // Simple color scale generation (would use a proper color library in production)
    return {
      50: this.adjustBrightness(baseColor, 0.95),
      100: this.adjustBrightness(baseColor, 0.9),
      200: this.adjustBrightness(baseColor, 0.8),
      300: this.adjustBrightness(baseColor, 0.6),
      400: this.adjustBrightness(baseColor, 0.4),
      500: baseColor,
      600: this.adjustBrightness(baseColor, -0.1),
      700: this.adjustBrightness(baseColor, -0.2),
      800: this.adjustBrightness(baseColor, -0.3),
      900: this.adjustBrightness(baseColor, -0.4),
    };
  }

  private adjustBrightness(hex: string, factor: number): string {
    // Simple brightness adjustment
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const adjust = (c: number) => Math.min(255, Math.max(0, Math.round(c + (factor > 0 ? (255 - c) * factor : c * factor))));

    return `#${adjust(r).toString(16).padStart(2, "0")}${adjust(g).toString(16).padStart(2, "0")}${adjust(b).toString(16).padStart(2, "0")}`;
  }

  private generateStyles(system: DesignSystem, type: ComponentType): string {
    const { styleFramework } = system.config;
    
    switch (styleFramework) {
      case "tailwind":
        return this.generateTailwindStyles(system, type);
      case "css":
      case "scss":
        return this.generateCssStyles(system, type, styleFramework === "scss");
      default:
        return this.generateCssStyles(system, type, false);
    }
  }

  private generateTailwindStyles(system: DesignSystem, type: ComponentType): string {
    const baseStyles: Record<ComponentType, string> = {
      button: `inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50`,
      input: `flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`,
      card: `rounded-lg border bg-card text-card-foreground shadow-sm`,
      modal: `fixed inset-0 z-50 flex items-center justify-center`,
      table: `w-full caption-bottom text-sm`,
      navigation: `flex items-center space-x-4`,
      layout: `min-h-screen`,
      form: `space-y-4`,
      display: ``,
      feedback: ``,
      custom: ``,
    };

    return baseStyles[type] || "";
  }

  private generateCssStyles(system: DesignSystem, type: ComponentType, isScss: boolean): string {
    const prefix = isScss ? "$" : "--";
    const tokens = system.tokens;

    const baseStyles = `
.${type} {
  font-family: ${tokens.typography.fontFamilies.sans};
  font-size: ${tokens.typography.fontSizes.base};
  line-height: ${tokens.typography.lineHeights.normal};
  transition-duration: ${tokens.transitions.normal};
  transition-timing-function: ${tokens.transitions.easings.easeInOut};
}
`;

    return baseStyles;
  }

  private generateCode(
    system: DesignSystem,
    type: ComponentType,
    name: string,
    props: ComponentProp[]
  ): string {
    const { componentFramework, typescript } = system.config;

    switch (componentFramework) {
      case "react":
        return this.generateReactComponent(name, props, typescript);
      case "vue":
        return this.generateVueComponent(name, props, typescript);
      case "svelte":
        return this.generateSvelteComponent(name, props);
      default:
        return this.generateReactComponent(name, props, typescript);
    }
  }

  private generateReactComponent(name: string, props: ComponentProp[], typescript: boolean): string {
    const propsInterface = typescript
      ? `interface ${name}Props {
  ${props.map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type};`).join("\n  ")}
  children?: React.ReactNode;
}`
      : "";

    const propsType = typescript ? `: ${name}Props` : "";
    const ext = typescript ? "tsx" : "jsx";

    return `import * as React from "react";
import { cn } from "../lib/utils";

${propsInterface}

export function ${name}({ ${props.map((p) => p.name).join(", ")}, children, ...rest }${propsType}) {
  return (
    <div className={cn("${name.toLowerCase()}")} {...rest}>
      {children}
    </div>
  );
}
`;
  }

  private generateVueComponent(name: string, props: ComponentProp[], typescript: boolean): string {
    const script = typescript ? "script setup lang=\"ts\"" : "script setup";

    return `<template>
  <div class="${name.toLowerCase()}">
    <slot />
  </div>
</template>

<${script}>
${props.map((p) => `defineProps<{ ${p.name}${p.required ? "" : "?"}: ${p.type} }>()`).join("\n")}
</${script.split(" ")[0]}>

<style scoped>
.${name.toLowerCase()} {
  /* Component styles */
}
</style>
`;
  }

  private generateSvelteComponent(name: string, props: ComponentProp[]): string {
    return `<script>
  ${props.map((p) => `export let ${p.name}${p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : ""};`).join("\n  ")}
</script>

<div class="${name.toLowerCase()}">
  <slot />
</div>

<style>
  .${name.toLowerCase()} {
    /* Component styles */
  }
</style>
`;
  }

  private generateStorybook(name: string, variants: ComponentVariant[], props: ComponentProp[]): string {
    return `import type { Meta, StoryObj } from "@storybook/react";
import { ${name} } from "./${name}";

const meta: Meta<typeof ${name}> = {
  title: "Components/${name}",
  component: ${name},
  tags: ["autodocs"],
  argTypes: {
    ${props.map((p) => `${p.name}: { control: ${p.options ? `{ type: "select", options: ${JSON.stringify(p.options)} }` : `"${p.type === "boolean" ? "boolean" : "text"}"`} },`).join("\n    ")}
  },
};

export default meta;
type Story = StoryObj<typeof ${name}>;

${variants.map((v) => `export const ${v.name}: Story = {
  args: ${JSON.stringify(v.props)},
};`).join("\n\n")}
`;
  }

  private generateTests(name: string): string {
    return `import { render, screen } from "@testing-library/react";
import { ${name} } from "./${name}";

describe("${name}", () => {
  it("renders correctly", () => {
    render(<${name}>Test</${name}>);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("applies className prop", () => {
    render(<${name} className="custom">Test</${name}>);
    expect(screen.getByText("Test")).toHaveClass("custom");
  });
});
`;
  }

  private generateDocs(name: string, description: string, props: ComponentProp[], variants: ComponentVariant[]): string {
    return `# ${name}

${description}

## Installation

\`\`\`bash
npm install @your-org/design-system
\`\`\`

## Usage

\`\`\`tsx
import { ${name} } from "@your-org/design-system";

function Example() {
  return <${name}>${name} content</${name}>;
}
\`\`\`

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
${props.map((p) => `| ${p.name} | \`${p.type}\` | ${p.default !== undefined ? `\`${JSON.stringify(p.default)}\`` : "-"} | ${p.description} |`).join("\n")}

## Variants

${variants.map((v) => `### ${v.name}\n\n\`\`\`tsx\n<${name} ${Object.entries(v.props).map(([k, val]) => `${k}="${val}"`).join(" ")} />\n\`\`\``).join("\n\n")}
`;
  }

  private async exportTokens(system: DesignSystem, outputDir: string): Promise<void> {
    const tokensDir = path.join(outputDir, "tokens");
    await fs.mkdir(tokensDir, { recursive: true });

    // Export as JSON
    await fs.writeFile(
      path.join(tokensDir, "tokens.json"),
      JSON.stringify(system.tokens, null, 2)
    );

    // Export as CSS variables
    const cssVars = this.tokensToCssVariables(system.tokens);
    await fs.writeFile(path.join(tokensDir, "tokens.css"), cssVars);

    // Export as Tailwind config
    if (system.config.styleFramework === "tailwind") {
      const tailwindConfig = this.tokensToTailwindConfig(system.tokens);
      await fs.writeFile(path.join(tokensDir, "tailwind.config.js"), tailwindConfig);
    }
  }

  private tokensToCssVariables(tokens: DesignTokens): string {
    const lines = [":root {"];
    
    // Colors
    for (const [category, colors] of Object.entries(tokens.colors)) {
      if (typeof colors === "object" && colors !== null) {
        for (const [shade, value] of Object.entries(colors)) {
          lines.push(`  --color-${category}-${shade}: ${value};`);
        }
      }
    }

    // Typography
    for (const [key, value] of Object.entries(tokens.typography.fontSizes)) {
      lines.push(`  --font-size-${key}: ${value};`);
    }

    // Spacing
    for (const [key, value] of Object.entries(tokens.spacing)) {
      lines.push(`  --spacing-${key}: ${value};`);
    }

    // Border radius
    for (const [key, value] of Object.entries(tokens.borderRadius)) {
      lines.push(`  --radius-${key}: ${value};`);
    }

    // Shadows
    for (const [key, value] of Object.entries(tokens.shadows)) {
      lines.push(`  --shadow-${key}: ${value};`);
    }

    lines.push("}");
    return lines.join("\n");
  }

  private tokensToTailwindConfig(tokens: DesignTokens): string {
    return `/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: ${JSON.stringify(tokens.colors, null, 6)},
      fontSize: ${JSON.stringify(tokens.typography.fontSizes, null, 6)},
      fontFamily: ${JSON.stringify(tokens.typography.fontFamilies, null, 6)},
      spacing: ${JSON.stringify(tokens.spacing, null, 6)},
      borderRadius: ${JSON.stringify(tokens.borderRadius, null, 6)},
      boxShadow: ${JSON.stringify(tokens.shadows, null, 6)},
    },
  },
};
`;
  }

  private async exportComponents(system: DesignSystem, outputDir: string): Promise<void> {
    const componentsDir = path.join(outputDir, "components");
    await fs.mkdir(componentsDir, { recursive: true });

    for (const component of system.components) {
      const componentDir = path.join(componentsDir, component.name);
      await fs.mkdir(componentDir, { recursive: true });

      const ext = system.config.typescript ? "tsx" : "jsx";
      await fs.writeFile(path.join(componentDir, `${component.name}.${ext}`), component.code);

      if (component.styles) {
        const styleExt = system.config.styleFramework === "scss" ? "scss" : "css";
        await fs.writeFile(path.join(componentDir, `${component.name}.${styleExt}`), component.styles);
      }
    }

    // Create index file
    const indexContent = system.components
      .map((c) => `export { ${c.name} } from "./${c.name}/${c.name}";`)
      .join("\n");
    await fs.writeFile(path.join(componentsDir, "index.ts"), indexContent);
  }

  private async exportStorybook(system: DesignSystem, outputDir: string): Promise<void> {
    const storiesDir = path.join(outputDir, "stories");
    await fs.mkdir(storiesDir, { recursive: true });

    for (const component of system.components) {
      if (component.storybook) {
        await fs.writeFile(
          path.join(storiesDir, `${component.name}.stories.tsx`),
          component.storybook
        );
      }
    }
  }

  private async exportTests(system: DesignSystem, outputDir: string): Promise<void> {
    const testsDir = path.join(outputDir, "__tests__");
    await fs.mkdir(testsDir, { recursive: true });

    for (const component of system.components) {
      if (component.tests) {
        await fs.writeFile(
          path.join(testsDir, `${component.name}.test.tsx`),
          component.tests
        );
      }
    }
  }

  private async exportDocs(system: DesignSystem, outputDir: string): Promise<void> {
    const docsDir = path.join(outputDir, "docs");
    await fs.mkdir(docsDir, { recursive: true });

    for (const component of system.components) {
      if (component.docs) {
        await fs.writeFile(
          path.join(docsDir, `${component.name}.md`),
          component.docs
        );
      }
    }

    // Create README
    const readme = `# ${system.name}

${system.description}

## Components

${system.components.map((c) => `- [${c.name}](./docs/${c.name}.md) - ${c.description}`).join("\n")}

## Installation

\`\`\`bash
npm install
\`\`\`

## Usage

\`\`\`tsx
import { Button, Card, Input } from "./components";
\`\`\`
`;
    await fs.writeFile(path.join(outputDir, "README.md"), readme);
  }

  private async createPackageJson(system: DesignSystem, outputDir: string): Promise<void> {
    const packageJson = {
      name: `@design-system/${system.name.toLowerCase().replace(/\s+/g, "-")}`,
      version: "1.0.0",
      description: system.description,
      main: "dist/index.js",
      module: "dist/index.esm.js",
      types: "dist/index.d.ts",
      files: ["dist"],
      scripts: {
        build: "tsup",
        dev: "tsup --watch",
        test: system.config.testing ? "vitest" : undefined,
        storybook: system.config.storybook ? "storybook dev -p 6006" : undefined,
      },
      peerDependencies: {
        react: "^18.0.0",
        "react-dom": "^18.0.0",
      },
      devDependencies: {
        tsup: "^8.0.0",
        typescript: "^5.0.0",
        ...(system.config.storybook ? { "@storybook/react": "^8.0.0" } : {}),
        ...(system.config.testing ? { vitest: "^1.0.0", "@testing-library/react": "^14.0.0" } : {}),
      },
    };

    await fs.writeFile(
      path.join(outputDir, "package.json"),
      JSON.stringify(packageJson, null, 2)
    );
  }

  private async loadSystems(): Promise<void> {
    try {
      const files = await fs.readdir(this.storageDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = await fs.readFile(path.join(this.storageDir, file), "utf-8");
          const system = JSON.parse(content) as DesignSystem;
          this.systems.set(system.id, system);
        }
      }
    } catch {
      // Storage directory doesn't exist yet
    }
  }

  private async saveSystem(system: DesignSystem): Promise<void> {
    const filePath = path.join(this.storageDir, `${system.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(system, null, 2));
  }

  private emitEvent(
    type: DesignSystemEventType,
    systemId: DesignSystemId,
    componentId?: ComponentId,
    data?: any
  ): void {
    const event: DesignSystemEvent = { type, systemId, componentId, data };
    this.emit("design-system:event", event);
  }

  subscribe(callback: (event: DesignSystemEvent) => void): () => void {
    this.on("design-system:event", callback);
    return () => this.off("design-system:event", callback);
  }
}

// Global instance
let designSystemGenerator: DesignSystemGenerator | null = null;

export function getDesignSystemGenerator(): DesignSystemGenerator {
  if (!designSystemGenerator) {
    designSystemGenerator = new DesignSystemGenerator();
  }
  return designSystemGenerator;
}
