/**
 * Visual App Builder
 * Drag-and-drop UI builder for creating apps without code.
 * Exports to React, Vue, Svelte, HTML, and React Native.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import { EventEmitter } from "events";

import type {
  AppId,
  AppComponent,
  ComponentId,
  ComponentType,
  ComponentStyles,
  ComponentEvent,
  AppPage,
  AppProject,
  AppExportFormat,
  AppExportOptions,
} from "@/types/sovereign_stack_types";

const logger = log.scope("visual_app_builder");

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_APPS_DIR = path.join(app.getPath("userData"), "apps");

// =============================================================================
// COMPONENT DEFINITIONS
// =============================================================================

interface ComponentDefinition {
  type: ComponentType;
  name: string;
  icon: string;
  category: "layout" | "input" | "display" | "navigation" | "media" | "data" | "custom";
  defaultProps: Record<string, unknown>;
  defaultStyles: Partial<ComponentStyles>;
  allowChildren: boolean;
  events: string[];
  propSchema: Record<string, { type: string; default?: unknown; options?: string[] }>;
}

const COMPONENT_DEFINITIONS: ComponentDefinition[] = [
  // Layout
  {
    type: "container",
    name: "Container",
    icon: "square",
    category: "layout",
    defaultProps: {},
    defaultStyles: { display: "flex", flexDirection: "column", padding: "16px" },
    allowChildren: true,
    events: ["onClick"],
    propSchema: {},
  },
  {
    type: "row",
    name: "Row",
    icon: "layout-grid",
    category: "layout",
    defaultProps: {},
    defaultStyles: { display: "flex", flexDirection: "row", gap: "8px" },
    allowChildren: true,
    events: [],
    propSchema: {},
  },
  {
    type: "column",
    name: "Column",
    icon: "layout-grid",
    category: "layout",
    defaultProps: {},
    defaultStyles: { display: "flex", flexDirection: "column", gap: "8px" },
    allowChildren: true,
    events: [],
    propSchema: {},
  },
  {
    type: "card",
    name: "Card",
    icon: "credit-card",
    category: "layout",
    defaultProps: { title: "Card Title" },
    defaultStyles: {
      backgroundColor: "#ffffff",
      borderRadius: "8px",
      padding: "16px",
      boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
    },
    allowChildren: true,
    events: ["onClick"],
    propSchema: {
      title: { type: "string", default: "Card Title" },
    },
  },
  {
    type: "modal",
    name: "Modal",
    icon: "layers",
    category: "layout",
    defaultProps: { title: "Modal", open: false },
    defaultStyles: {},
    allowChildren: true,
    events: ["onOpen", "onClose"],
    propSchema: {
      title: { type: "string", default: "Modal" },
      open: { type: "boolean", default: false },
    },
  },
  
  // Input
  {
    type: "button",
    name: "Button",
    icon: "mouse-pointer",
    category: "input",
    defaultProps: { label: "Button", variant: "primary" },
    defaultStyles: {
      padding: "8px 16px",
      borderRadius: "4px",
      backgroundColor: "#3b82f6",
      color: "#ffffff",
      cursor: "pointer",
    },
    allowChildren: false,
    events: ["onClick"],
    propSchema: {
      label: { type: "string", default: "Button" },
      variant: { type: "select", options: ["primary", "secondary", "outline", "ghost"], default: "primary" },
      disabled: { type: "boolean", default: false },
    },
  },
  {
    type: "input",
    name: "Text Input",
    icon: "type",
    category: "input",
    defaultProps: { placeholder: "Enter text...", type: "text" },
    defaultStyles: {
      padding: "8px 12px",
      borderRadius: "4px",
      border: "1px solid #d1d5db",
    },
    allowChildren: false,
    events: ["onChange", "onFocus", "onBlur"],
    propSchema: {
      placeholder: { type: "string", default: "Enter text..." },
      type: { type: "select", options: ["text", "password", "email", "number", "tel", "url"], default: "text" },
      label: { type: "string" },
      required: { type: "boolean", default: false },
    },
  },
  {
    type: "textarea",
    name: "Text Area",
    icon: "align-left",
    category: "input",
    defaultProps: { placeholder: "Enter text...", rows: 4 },
    defaultStyles: {
      padding: "8px 12px",
      borderRadius: "4px",
      border: "1px solid #d1d5db",
      minHeight: "100px",
    },
    allowChildren: false,
    events: ["onChange", "onFocus", "onBlur"],
    propSchema: {
      placeholder: { type: "string", default: "Enter text..." },
      rows: { type: "number", default: 4 },
      label: { type: "string" },
    },
  },
  {
    type: "select",
    name: "Select",
    icon: "chevron-down",
    category: "input",
    defaultProps: { options: ["Option 1", "Option 2", "Option 3"] },
    defaultStyles: {
      padding: "8px 12px",
      borderRadius: "4px",
      border: "1px solid #d1d5db",
    },
    allowChildren: false,
    events: ["onChange"],
    propSchema: {
      options: { type: "array", default: ["Option 1", "Option 2"] },
      placeholder: { type: "string", default: "Select..." },
      label: { type: "string" },
    },
  },
  {
    type: "checkbox",
    name: "Checkbox",
    icon: "check-square",
    category: "input",
    defaultProps: { label: "Checkbox", checked: false },
    defaultStyles: {},
    allowChildren: false,
    events: ["onChange"],
    propSchema: {
      label: { type: "string", default: "Checkbox" },
      checked: { type: "boolean", default: false },
    },
  },
  {
    type: "switch",
    name: "Switch",
    icon: "toggle-left",
    category: "input",
    defaultProps: { label: "Switch", checked: false },
    defaultStyles: {},
    allowChildren: false,
    events: ["onChange"],
    propSchema: {
      label: { type: "string", default: "Switch" },
      checked: { type: "boolean", default: false },
    },
  },
  {
    type: "slider",
    name: "Slider",
    icon: "sliders",
    category: "input",
    defaultProps: { min: 0, max: 100, value: 50 },
    defaultStyles: { width: "100%" },
    allowChildren: false,
    events: ["onChange"],
    propSchema: {
      min: { type: "number", default: 0 },
      max: { type: "number", default: 100 },
      step: { type: "number", default: 1 },
      value: { type: "number", default: 50 },
    },
  },
  {
    type: "form",
    name: "Form",
    icon: "file-text",
    category: "input",
    defaultProps: {},
    defaultStyles: { display: "flex", flexDirection: "column", gap: "16px" },
    allowChildren: true,
    events: ["onSubmit"],
    propSchema: {},
  },
  
  // Display
  {
    type: "text",
    name: "Text",
    icon: "type",
    category: "display",
    defaultProps: { content: "Text content", variant: "body" },
    defaultStyles: {},
    allowChildren: false,
    events: [],
    propSchema: {
      content: { type: "string", default: "Text content" },
      variant: { type: "select", options: ["h1", "h2", "h3", "h4", "body", "caption"], default: "body" },
    },
  },
  {
    type: "image",
    name: "Image",
    icon: "image",
    category: "media",
    defaultProps: { src: "https://via.placeholder.com/300", alt: "Image" },
    defaultStyles: { maxWidth: "100%", height: "auto", borderRadius: "4px" },
    allowChildren: false,
    events: ["onClick", "onLoad", "onError"],
    propSchema: {
      src: { type: "string", default: "https://via.placeholder.com/300" },
      alt: { type: "string", default: "Image" },
      objectFit: { type: "select", options: ["contain", "cover", "fill", "none"], default: "contain" },
    },
  },
  {
    type: "icon",
    name: "Icon",
    icon: "star",
    category: "display",
    defaultProps: { name: "star", size: 24 },
    defaultStyles: {},
    allowChildren: false,
    events: ["onClick"],
    propSchema: {
      name: { type: "string", default: "star" },
      size: { type: "number", default: 24 },
      color: { type: "color", default: "#000000" },
    },
  },
  {
    type: "badge",
    name: "Badge",
    icon: "award",
    category: "display",
    defaultProps: { label: "Badge", variant: "default" },
    defaultStyles: {
      padding: "2px 8px",
      borderRadius: "9999px",
      fontSize: "12px",
      backgroundColor: "#e5e7eb",
    },
    allowChildren: false,
    events: [],
    propSchema: {
      label: { type: "string", default: "Badge" },
      variant: { type: "select", options: ["default", "success", "warning", "error"], default: "default" },
    },
  },
  {
    type: "avatar",
    name: "Avatar",
    icon: "user",
    category: "display",
    defaultProps: { src: "", name: "User", size: "md" },
    defaultStyles: { borderRadius: "9999px" },
    allowChildren: false,
    events: ["onClick"],
    propSchema: {
      src: { type: "string" },
      name: { type: "string", default: "User" },
      size: { type: "select", options: ["sm", "md", "lg"], default: "md" },
    },
  },
  {
    type: "divider",
    name: "Divider",
    icon: "minus",
    category: "display",
    defaultProps: {},
    defaultStyles: { borderTop: "1px solid #e5e7eb", margin: "16px 0" },
    allowChildren: false,
    events: [],
    propSchema: {},
  },
  {
    type: "progress",
    name: "Progress",
    icon: "loader",
    category: "display",
    defaultProps: { value: 50, max: 100 },
    defaultStyles: { width: "100%", height: "8px" },
    allowChildren: false,
    events: [],
    propSchema: {
      value: { type: "number", default: 50 },
      max: { type: "number", default: 100 },
      variant: { type: "select", options: ["linear", "circular"], default: "linear" },
    },
  },
  {
    type: "spinner",
    name: "Spinner",
    icon: "loader",
    category: "display",
    defaultProps: { size: "md" },
    defaultStyles: {},
    allowChildren: false,
    events: [],
    propSchema: {
      size: { type: "select", options: ["sm", "md", "lg"], default: "md" },
    },
  },
  
  // Data
  {
    type: "table",
    name: "Table",
    icon: "table",
    category: "data",
    defaultProps: {
      columns: [
        { key: "name", label: "Name" },
        { key: "value", label: "Value" },
      ],
      data: [
        { name: "Row 1", value: "Value 1" },
        { name: "Row 2", value: "Value 2" },
      ],
    },
    defaultStyles: { width: "100%", borderCollapse: "collapse" },
    allowChildren: false,
    events: ["onRowClick"],
    propSchema: {
      columns: { type: "array", default: [] },
      data: { type: "array", default: [] },
      striped: { type: "boolean", default: false },
    },
  },
  {
    type: "list",
    name: "List",
    icon: "list",
    category: "data",
    defaultProps: { items: ["Item 1", "Item 2", "Item 3"] },
    defaultStyles: {},
    allowChildren: false,
    events: ["onItemClick"],
    propSchema: {
      items: { type: "array", default: ["Item 1", "Item 2"] },
      variant: { type: "select", options: ["ordered", "unordered", "none"], default: "unordered" },
    },
  },
  {
    type: "chart",
    name: "Chart",
    icon: "bar-chart",
    category: "data",
    defaultProps: {
      type: "bar",
      data: {
        labels: ["A", "B", "C"],
        datasets: [{ data: [10, 20, 30] }],
      },
    },
    defaultStyles: { width: "100%", height: "300px" },
    allowChildren: false,
    events: [],
    propSchema: {
      type: { type: "select", options: ["bar", "line", "pie", "doughnut", "area"], default: "bar" },
      data: { type: "object" },
    },
  },
  
  // Navigation
  {
    type: "link",
    name: "Link",
    icon: "link",
    category: "navigation",
    defaultProps: { label: "Link", href: "#" },
    defaultStyles: { color: "#3b82f6", textDecoration: "underline", cursor: "pointer" },
    allowChildren: false,
    events: ["onClick"],
    propSchema: {
      label: { type: "string", default: "Link" },
      href: { type: "string", default: "#" },
      target: { type: "select", options: ["_self", "_blank"], default: "_self" },
    },
  },
  {
    type: "tabs",
    name: "Tabs",
    icon: "folder",
    category: "navigation",
    defaultProps: {
      tabs: [
        { id: "tab1", label: "Tab 1" },
        { id: "tab2", label: "Tab 2" },
      ],
    },
    defaultStyles: {},
    allowChildren: true,
    events: ["onTabChange"],
    propSchema: {
      tabs: { type: "array", default: [] },
      defaultTab: { type: "string" },
    },
  },
  
  // Custom
  {
    type: "custom",
    name: "Custom",
    icon: "code",
    category: "custom",
    defaultProps: { code: "" },
    defaultStyles: {},
    allowChildren: false,
    events: [],
    propSchema: {
      code: { type: "code", default: "" },
    },
  },
];

// =============================================================================
// VISUAL APP BUILDER SERVICE
// =============================================================================

export class VisualAppBuilder extends EventEmitter {
  private appsDir: string;
  private projects: Map<AppId, AppProject> = new Map();
  
  constructor(appsDir?: string) {
    super();
    this.appsDir = appsDir || DEFAULT_APPS_DIR;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing visual app builder", { appsDir: this.appsDir });
    
    await fs.mkdir(this.appsDir, { recursive: true });
    await this.scanProjects();
    
    logger.info("Visual app builder initialized", { projectCount: this.projects.size });
  }
  
  private async scanProjects(): Promise<void> {
    const entries = await fs.readdir(this.appsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const configPath = path.join(this.appsDir, entry.name, "project.json");
        
        if (existsSync(configPath)) {
          try {
            const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
            this.projects.set(config.id as AppId, config);
          } catch (error) {
            logger.warn("Failed to load project config", { path: configPath, error });
          }
        }
      }
    }
  }
  
  // ===========================================================================
  // COMPONENT DEFINITIONS
  // ===========================================================================
  
  getComponentDefinitions(): ComponentDefinition[] {
    return COMPONENT_DEFINITIONS;
  }
  
  getComponentDefinition(type: ComponentType): ComponentDefinition | null {
    return COMPONENT_DEFINITIONS.find((d) => d.type === type) || null;
  }
  
  // ===========================================================================
  // PROJECT MANAGEMENT
  // ===========================================================================
  
  async createProject(params: {
    name: string;
    description?: string;
    framework?: AppExportFormat;
    metadata?: Record<string, unknown>;
  }): Promise<AppProject> {
    const id = crypto.randomUUID() as AppId;
    const projectDir = path.join(this.appsDir, id);
    await fs.mkdir(projectDir, { recursive: true });
    
    // Create default home page
    const homePage: AppPage = {
      id: crypto.randomUUID(),
      name: "Home",
      path: "/",
      components: [],
      variables: {},
      metadata: {},
      updatedAt: Date.now(),
    };
    
    // Filter framework to valid values (react-native not supported in AppProject)
    const validFramework = params.framework === "react-native" ? "react" : (params.framework || "react") as "react" | "vue" | "svelte" | "html";
    
    const project: AppProject = {
      id,
      name: params.name,
      description: params.description,
      version: "1.0.0",
      pages: [homePage],
      globalStyles: {
        fontFamily: "Inter, system-ui, sans-serif",
        colors: {
          primary: "#3b82f6",
          secondary: "#6b7280",
          success: "#10b981",
          warning: "#f59e0b",
          error: "#ef4444",
          background: "#ffffff",
          foreground: "#111827",
        },
        spacing: {
          xs: "4px",
          sm: "8px",
          md: "16px",
          lg: "24px",
          xl: "32px",
        },
      },
      globalVariables: {},
      apiEndpoints: [],
      dataStores: [],
      agents: [],
      workflows: [],
      framework: validFramework,
      buildConfig: {
        outputDir: "dist",
        minify: true,
        sourceMaps: false,
        ssr: false,
        pwa: false,
        target: "web",
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await this.saveProject(project);
    this.projects.set(project.id as AppId, project);
    this.emit("project:created", project);
    
    return project;
  }
  
  async saveProject(project: AppProject): Promise<void> {
    const projectDir = path.join(this.appsDir, project.id);
    await fs.mkdir(projectDir, { recursive: true });
    
    project.updatedAt = Date.now();
    await fs.writeFile(
      path.join(projectDir, "project.json"),
      JSON.stringify(project, null, 2)
    );
    
    this.projects.set(project.id as AppId, project);
  }
  
  listProjects(): AppProject[] {
    return Array.from(this.projects.values());
  }
  
  getProject(id: AppId): AppProject | null {
    return this.projects.get(id) || null;
  }
  
  async deleteProject(id: AppId): Promise<void> {
    const projectDir = path.join(this.appsDir, id);
    if (existsSync(projectDir)) {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
    
    this.projects.delete(id);
    this.emit("project:deleted", { id });
  }
  
  // ===========================================================================
  // PAGE MANAGEMENT
  // ===========================================================================
  
  async addPage(projectId: AppId, params: {
    name: string;
    path: string;
    metadata?: Record<string, unknown>;
  }): Promise<AppPage> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    const page: AppPage = {
      id: crypto.randomUUID(),
      name: params.name,
      path: params.path,
      components: [],
      variables: {},
      metadata: params.metadata || {},
      updatedAt: Date.now(),
    };
    
    project.pages.push(page);
    await this.saveProject(project);
    this.emit("page:created", { projectId, page });
    
    return page;
  }
  
  async updatePage(projectId: AppId, pageId: string, updates: Partial<AppPage>): Promise<AppPage> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    const pageIndex = project.pages.findIndex((p) => p.id === pageId);
    if (pageIndex === -1) {
      throw new Error(`Page not found: ${pageId}`);
    }
    
    const page = {
      ...project.pages[pageIndex],
      ...updates,
      updatedAt: Date.now(),
    };
    
    project.pages[pageIndex] = page;
    await this.saveProject(project);
    this.emit("page:updated", { projectId, page });
    
    return page;
  }
  
  async deletePage(projectId: AppId, pageId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    project.pages = project.pages.filter((p) => p.id !== pageId);
    await this.saveProject(project);
    this.emit("page:deleted", { projectId, pageId });
  }
  
  // ===========================================================================
  // COMPONENT MANAGEMENT
  // ===========================================================================
  
  createComponent(type: ComponentType, overrides?: Partial<AppComponent>): AppComponent {
    const def = this.getComponentDefinition(type);
    if (!def) {
      throw new Error(`Unknown component type: ${type}`);
    }
    
    return {
      id: crypto.randomUUID() as ComponentId,
      type,
      name: def.name,
      props: { ...def.defaultProps, ...overrides?.props },
      styles: { ...def.defaultStyles, ...overrides?.styles } as ComponentStyles,
      children: def.allowChildren ? [] : undefined,
      events: [],
      bindings: [],
    };
  }
  
  async addComponent(
    projectId: AppId,
    pageId: string,
    parentId: string | null,
    component: AppComponent
  ): Promise<AppComponent> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    const page = project.pages.find((p) => p.id === pageId);
    if (!page) {
      throw new Error(`Page not found: ${pageId}`);
    }
    
    // Always add component to the flat list
    page.components.push(component);
    
    if (parentId !== null) {
      const parent = this.findComponent(page.components, parentId);
      if (!parent) {
        throw new Error(`Parent component not found: ${parentId}`);
      }
      if (!parent.children) {
        parent.children = [];
      }
      // Store component ID in parent's children array
      parent.children.push(component.id);
      // Set parentId reference
      component.parentId = parentId as ComponentId;
    }
    
    page.updatedAt = Date.now();
    await this.saveProject(project);
    this.emit("component:added", { projectId, pageId, component });
    
    return component;
  }
  
  async updateComponent(
    projectId: AppId,
    pageId: string,
    componentId: string,
    updates: Partial<AppComponent>
  ): Promise<AppComponent> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    const page = project.pages.find((p) => p.id === pageId);
    if (!page) {
      throw new Error(`Page not found: ${pageId}`);
    }
    
    const component = this.findComponent(page.components, componentId);
    if (!component) {
      throw new Error(`Component not found: ${componentId}`);
    }
    
    Object.assign(component, updates);
    page.updatedAt = Date.now();
    await this.saveProject(project);
    this.emit("component:updated", { projectId, pageId, component });
    
    return component;
  }
  
  async deleteComponent(projectId: AppId, pageId: string, componentId: string): Promise<void> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    const page = project.pages.find((p) => p.id === pageId);
    if (!page) {
      throw new Error(`Page not found: ${pageId}`);
    }
    
    this.removeComponent(page.components, componentId);
    page.updatedAt = Date.now();
    await this.saveProject(project);
    this.emit("component:deleted", { projectId, pageId, componentId });
  }
  
  private findComponent(components: AppComponent[], id: string): AppComponent | null {
    // Components are stored in a flat list, just find by ID
    return components.find((comp) => comp.id === id) || null;
  }
  
  private removeComponent(components: AppComponent[], id: string): boolean {
    const index = components.findIndex((c) => c.id === id);
    if (index !== -1) {
      const removed = components[index];
      // Also remove from parent's children array if it has a parent
      if (removed.parentId) {
        const parent = this.findComponent(components, removed.parentId);
        if (parent && parent.children) {
          const childIndex = parent.children.indexOf(removed.id);
          if (childIndex !== -1) {
            parent.children.splice(childIndex, 1);
          }
        }
      }
      components.splice(index, 1);
      return true;
    }
    
    return false;
  }
  
  // ===========================================================================
  // CODE EXPORT
  // ===========================================================================
  
  async exportProject(projectId: AppId, options: AppExportOptions): Promise<string> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    
    const outputDir = options.outputDir || path.join(this.appsDir, projectId, "export");
    await fs.mkdir(outputDir, { recursive: true });
    
    switch (options.format) {
      case "react":
        await this.exportToReact(project, outputDir, options);
        break;
      case "vue":
        await this.exportToVue(project, outputDir, options);
        break;
      case "svelte":
        await this.exportToSvelte(project, outputDir, options);
        break;
      case "html":
        await this.exportToHtml(project, outputDir, options);
        break;
      case "react-native":
        await this.exportToReactNative(project, outputDir, options);
        break;
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
    
    this.emit("project:exported", { projectId, outputDir, format: options.format });
    return outputDir;
  }
  
  // ===========================================================================
  // REACT EXPORT
  // ===========================================================================
  
  private async exportToReact(project: AppProject, outputDir: string, options: AppExportOptions): Promise<void> {
    const srcDir = path.join(outputDir, "src");
    const pagesDir = path.join(srcDir, "pages");
    const componentsDir = path.join(srcDir, "components");
    
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(pagesDir, { recursive: true });
    await fs.mkdir(componentsDir, { recursive: true });
    
    // Generate package.json
    await fs.writeFile(path.join(outputDir, "package.json"), JSON.stringify({
      name: project.name.toLowerCase().replace(/\s+/g, "-"),
      version: project.version,
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc && vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^18.3.1",
        "react-dom": "^18.3.1",
        "react-router-dom": "^6.26.0",
      },
      devDependencies: {
        "@types/react": "^18.3.3",
        "@types/react-dom": "^18.3.0",
        "@vitejs/plugin-react": "^4.3.1",
        typescript: "^5.5.4",
        vite: "^5.4.0",
      },
    }, null, 2));
    
    // Generate vite.config.ts
    await fs.writeFile(path.join(outputDir, "vite.config.ts"), `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`);
    
    // Generate tsconfig.json
    await fs.writeFile(path.join(outputDir, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        useDefineForClassFields: true,
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        module: "ESNext",
        skipLibCheck: true,
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
      },
      include: ["src"],
    }, null, 2));
    
    // Generate index.html
    await fs.writeFile(path.join(outputDir, "index.html"), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${project.name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`);
    
    // Generate main.tsx
    await fs.writeFile(path.join(srcDir, "main.tsx"), `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles.css';
${project.pages.map((p) => `import ${this.pageComponentName(p)} from './pages/${this.pageFileName(p)}';`).join("\n")}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
${project.pages.map((p) => `        <Route path="${p.path}" element={<${this.pageComponentName(p)} />} />`).join("\n")}
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
`);
    
    // Generate global styles
    await fs.writeFile(path.join(srcDir, "styles.css"), this.generateGlobalStyles(project));
    
    // Generate pages
    for (const page of project.pages) {
      const pageCode = this.generateReactPage(page);
      await fs.writeFile(path.join(pagesDir, `${this.pageFileName(page)}.tsx`), pageCode);
    }
  }
  
  private generateReactPage(page: AppPage): string {
    const imports = new Set<string>();
    // Create a map of component ID to component for efficient lookup
    const componentMap = new Map(page.components.map(c => [c.id as string, c]));
    // Get root components (those without a parent)
    const rootComponents = page.components.filter(c => !c.parentId);
    const componentCode = rootComponents.map((c) => this.generateReactComponent(c, componentMap, imports)).join("\n");
    
    return `
import React from 'react';
${Array.from(imports).join("\n")}

export default function ${this.pageComponentName(page)}() {
  return (
    <div className="page">
${componentCode}
    </div>
  );
}
`;
  }
  
  private generateReactComponent(component: AppComponent, componentMap: Map<string, AppComponent>, imports: Set<string>, indent = 6): string {
    const spaces = " ".repeat(indent);
    const def = this.getComponentDefinition(component.type);
    const styleAttr = Object.keys(component.styles || {}).length > 0
      ? ` style={${JSON.stringify(component.styles)}}`
      : "";
    
    let children = "";
    if (component.children && component.children.length > 0) {
      children = "\n" + component.children
        .map((childId) => {
          const childComponent = componentMap.get(childId as string);
          return childComponent ? this.generateReactComponent(childComponent, componentMap, imports, indent + 2) : "";
        })
        .filter(Boolean)
        .join("\n") + "\n" + spaces;
    }
    
    switch (component.type) {
      case "container":
      case "row":
      case "column":
        return `${spaces}<div${styleAttr}>${children}</div>`;
      
      case "text":
        const variant = String(component.props.variant || "body");
        const tag = variant.startsWith("h") ? variant : "p";
        return `${spaces}<${tag}${styleAttr}>${component.props.content || ""}</${tag}>`;
      
      case "button":
        return `${spaces}<button${styleAttr} onClick={() => {}}>${component.props.label || "Button"}</button>`;
      
      case "input":
        return `${spaces}<input type="${component.props.type || "text"}" placeholder="${component.props.placeholder || ""}"${styleAttr} />`;
      
      case "textarea":
        return `${spaces}<textarea placeholder="${component.props.placeholder || ""}" rows={${component.props.rows || 4}}${styleAttr}></textarea>`;
      
      case "image":
        return `${spaces}<img src="${component.props.src || ""}" alt="${component.props.alt || ""}"${styleAttr} />`;
      
      case "link":
        return `${spaces}<a href="${component.props.href || "#"}"${styleAttr}>${component.props.label || "Link"}</a>`;
      
      case "card":
        return `${spaces}<div className="card"${styleAttr}>${children}</div>`;
      
      case "form":
        return `${spaces}<form onSubmit={(e) => e.preventDefault()}${styleAttr}>${children}</form>`;
      
      case "checkbox":
        return `${spaces}<label${styleAttr}><input type="checkbox" />${component.props.label || ""}</label>`;
      
      case "select":
        const options = (component.props.options as string[]) || [];
        return `${spaces}<select${styleAttr}>${options.map((o) => `<option value="${o}">${o}</option>`).join("")}</select>`;
      
      default:
        return `${spaces}<div${styleAttr}>{/* ${component.type} */}${children}</div>`;
    }
  }
  
  // ===========================================================================
  // VUE EXPORT
  // ===========================================================================
  
  private async exportToVue(project: AppProject, outputDir: string, options: AppExportOptions): Promise<void> {
    const srcDir = path.join(outputDir, "src");
    const pagesDir = path.join(srcDir, "pages");
    
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(pagesDir, { recursive: true });
    
    // Generate package.json
    await fs.writeFile(path.join(outputDir, "package.json"), JSON.stringify({
      name: project.name.toLowerCase().replace(/\s+/g, "-"),
      version: project.version,
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
      },
      dependencies: {
        vue: "^3.4.0",
        "vue-router": "^4.3.0",
      },
      devDependencies: {
        "@vitejs/plugin-vue": "^5.0.0",
        vite: "^5.4.0",
      },
    }, null, 2));
    
    // Generate pages
    for (const page of project.pages) {
      const pageCode = this.generateVuePage(page);
      await fs.writeFile(path.join(pagesDir, `${this.pageFileName(page)}.vue`), pageCode);
    }
    
    // Generate main.ts
    await fs.writeFile(path.join(srcDir, "main.ts"), `
import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
${project.pages.map((p) => `import ${this.pageComponentName(p)} from './pages/${this.pageFileName(p)}.vue';`).join("\n")}

const router = createRouter({
  history: createWebHistory(),
  routes: [
${project.pages.map((p) => `    { path: '${p.path}', component: ${this.pageComponentName(p)} },`).join("\n")}
  ],
});

createApp(App).use(router).mount('#app');
`);
    
    // Generate App.vue
    await fs.writeFile(path.join(srcDir, "App.vue"), `
<template>
  <router-view />
</template>

<script setup lang="ts">
</script>
`);
  }
  
  private generateVuePage(page: AppPage): string {
    // Create a map of component ID to component for efficient lookup
    const componentMap = new Map(page.components.map(c => [c.id as string, c]));
    // Get root components (those without a parent)
    const rootComponents = page.components.filter(c => !c.parentId);
    const templateContent = rootComponents.map((c) => this.generateVueComponent(c, componentMap)).join("\n");
    
    return `<template>
  <div class="page">
${templateContent}
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.page {
  padding: 16px;
}
</style>
`;
  }
  
  private generateVueComponent(component: AppComponent, componentMap: Map<string, AppComponent>, indent = 4): string {
    const spaces = " ".repeat(indent);
    const styleAttr = Object.keys(component.styles || {}).length > 0
      ? ` :style="${JSON.stringify(component.styles).replace(/"/g, "'")}"`
      : "";
    
    let children = "";
    if (component.children && component.children.length > 0) {
      children = "\n" + component.children
        .map((childId) => {
          const childComponent = componentMap.get(childId as string);
          return childComponent ? this.generateVueComponent(childComponent, componentMap, indent + 2) : "";
        })
        .filter(Boolean)
        .join("\n") + "\n" + spaces;
    }
    
    switch (component.type) {
      case "text":
        const variant = String(component.props.variant || "body");
        const tag = variant.startsWith("h") ? variant : "p";
        return `${spaces}<${tag}${styleAttr}>${component.props.content || ""}</${tag}>`;
      
      case "button":
        return `${spaces}<button${styleAttr} @click="">${component.props.label || "Button"}</button>`;
      
      case "input":
        return `${spaces}<input type="${component.props.type || "text"}" placeholder="${component.props.placeholder || ""}"${styleAttr} />`;
      
      default:
        return `${spaces}<div${styleAttr}>${children}</div>`;
    }
  }
  
  // ===========================================================================
  // SVELTE EXPORT
  // ===========================================================================
  
  private async exportToSvelte(project: AppProject, outputDir: string, options: AppExportOptions): Promise<void> {
    const srcDir = path.join(outputDir, "src");
    const routesDir = path.join(srcDir, "routes");
    
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(routesDir, { recursive: true });
    
    // Generate package.json
    await fs.writeFile(path.join(outputDir, "package.json"), JSON.stringify({
      name: project.name.toLowerCase().replace(/\s+/g, "-"),
      version: project.version,
      scripts: {
        dev: "vite dev",
        build: "vite build",
        preview: "vite preview",
      },
      devDependencies: {
        "@sveltejs/kit": "^2.0.0",
        "@sveltejs/vite-plugin-svelte": "^3.0.0",
        svelte: "^4.2.0",
        vite: "^5.4.0",
      },
    }, null, 2));
    
    // Generate pages
    for (const page of project.pages) {
      const pagePath = page.path === "/" ? "+page.svelte" : `${page.path.slice(1)}/+page.svelte`;
      const pageDir = path.dirname(path.join(routesDir, pagePath));
      await fs.mkdir(pageDir, { recursive: true });
      
      const pageCode = this.generateSveltePage(page);
      await fs.writeFile(path.join(routesDir, pagePath), pageCode);
    }
  }
  
  private generateSveltePage(page: AppPage): string {
    // Create a map of component ID to component for efficient lookup
    const componentMap = new Map(page.components.map(c => [c.id as string, c]));
    // Get root components (those without a parent)
    const rootComponents = page.components.filter(c => !c.parentId);
    const content = rootComponents.map((c) => this.generateSvelteComponent(c, componentMap)).join("\n");
    
    return `<script lang="ts">
</script>

<div class="page">
${content}
</div>

<style>
.page {
  padding: 16px;
}
</style>
`;
  }
  
  private generateSvelteComponent(component: AppComponent, componentMap: Map<string, AppComponent>, indent = 2): string {
    const spaces = " ".repeat(indent);
    const styleAttr = Object.keys(component.styles || {}).length > 0
      ? ` style="${this.stylesToCss(component.styles)}"`
      : "";
    
    let children = "";
    if (component.children && component.children.length > 0) {
      children = "\n" + component.children
        .map((childId) => {
          const childComponent = componentMap.get(childId as string);
          return childComponent ? this.generateSvelteComponent(childComponent, componentMap, indent + 2) : "";
        })
        .filter(Boolean)
        .join("\n") + "\n" + spaces;
    }
    
    switch (component.type) {
      case "text":
        const variant = String(component.props.variant || "body");
        const tag = variant.startsWith("h") ? variant : "p";
        return `${spaces}<${tag}${styleAttr}>${component.props.content || ""}</${tag}>`;
      
      case "button":
        return `${spaces}<button${styleAttr} on:click>{${component.props.label || "Button"}}</button>`;
      
      case "input":
        return `${spaces}<input type="${component.props.type || "text"}" placeholder="${component.props.placeholder || ""}"${styleAttr} />`;
      
      default:
        return `${spaces}<div${styleAttr}>${children}</div>`;
    }
  }
  
  // ===========================================================================
  // HTML EXPORT
  // ===========================================================================
  
  private async exportToHtml(project: AppProject, outputDir: string, options: AppExportOptions): Promise<void> {
    // Generate single HTML file
    const css = this.generateGlobalStyles(project);
    const pages = project.pages.map((page) => {
      // Create a map of component ID to component for efficient lookup
      const componentMap = new Map(page.components.map(c => [c.id as string, c]));
      // Get root components (those without a parent)
      const rootComponents = page.components.filter(c => !c.parentId);
      const content = rootComponents.map((c) => this.generateHtmlComponent(c, componentMap)).join("\n");
      return `
  <section id="${page.path.replace(/\//g, "-") || "home"}" class="page">
${content}
  </section>`;
    }).join("\n");
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${project.name}</title>
  <style>
${css}
  </style>
</head>
<body>
${pages}
</body>
</html>
`;
    
    await fs.writeFile(path.join(outputDir, "index.html"), html);
  }
  
  private generateHtmlComponent(component: AppComponent, componentMap: Map<string, AppComponent>, indent = 4): string {
    const spaces = " ".repeat(indent);
    const styleAttr = Object.keys(component.styles || {}).length > 0
      ? ` style="${this.stylesToCss(component.styles)}"`
      : "";
    
    let children = "";
    if (component.children && component.children.length > 0) {
      children = "\n" + component.children
        .map((childId) => {
          const childComponent = componentMap.get(childId as string);
          return childComponent ? this.generateHtmlComponent(childComponent, componentMap, indent + 2) : "";
        })
        .filter(Boolean)
        .join("\n") + "\n" + spaces;
    }
    
    switch (component.type) {
      case "text":
        const variant = String(component.props.variant || "body");
        const tag = variant.startsWith("h") ? variant : "p";
        return `${spaces}<${tag}${styleAttr}>${component.props.content || ""}</${tag}>`;
      
      case "button":
        return `${spaces}<button${styleAttr}>${component.props.label || "Button"}</button>`;
      
      case "input":
        return `${spaces}<input type="${component.props.type || "text"}" placeholder="${component.props.placeholder || ""}"${styleAttr}>`;
      
      case "image":
        return `${spaces}<img src="${component.props.src || ""}" alt="${component.props.alt || ""}"${styleAttr}>`;
      
      case "link":
        return `${spaces}<a href="${component.props.href || "#"}"${styleAttr}>${component.props.label || "Link"}</a>`;
      
      default:
        return `${spaces}<div${styleAttr}>${children}</div>`;
    }
  }
  
  // ===========================================================================
  // REACT NATIVE EXPORT
  // ===========================================================================
  
  private async exportToReactNative(project: AppProject, outputDir: string, options: AppExportOptions): Promise<void> {
    const srcDir = path.join(outputDir, "src");
    const screensDir = path.join(srcDir, "screens");
    
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(screensDir, { recursive: true });
    
    // Generate package.json
    await fs.writeFile(path.join(outputDir, "package.json"), JSON.stringify({
      name: project.name.toLowerCase().replace(/\s+/g, "-"),
      version: project.version,
      main: "node_modules/expo/AppEntry.js",
      scripts: {
        start: "expo start",
        android: "expo start --android",
        ios: "expo start --ios",
      },
      dependencies: {
        expo: "~51.0.0",
        react: "18.2.0",
        "react-native": "0.74.3",
        "@react-navigation/native": "^6.1.0",
        "@react-navigation/native-stack": "^6.9.0",
      },
      devDependencies: {
        "@types/react": "~18.2.79",
        typescript: "~5.3.3",
      },
    }, null, 2));
    
    // Generate screens
    for (const page of project.pages) {
      const screenCode = this.generateReactNativeScreen(page);
      await fs.writeFile(path.join(screensDir, `${this.pageComponentName(page)}.tsx`), screenCode);
    }
    
    // Generate App.tsx
    await fs.writeFile(path.join(srcDir, "App.tsx"), `
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
${project.pages.map((p) => `import ${this.pageComponentName(p)} from './screens/${this.pageComponentName(p)}';`).join("\n")}

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
${project.pages.map((p) => `        <Stack.Screen name="${p.name}" component={${this.pageComponentName(p)}} />`).join("\n")}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
`);
  }
  
  private generateReactNativeScreen(page: AppPage): string {
    // Create a map of component ID to component for efficient lookup
    const componentMap = new Map(page.components.map(c => [c.id as string, c]));
    // Get root components (those without a parent)
    const rootComponents = page.components.filter(c => !c.parentId);
    const content = rootComponents.map((c) => this.generateReactNativeComponent(c, componentMap)).join("\n");
    
    return `
import React from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, StyleSheet, ScrollView } from 'react-native';

export default function ${this.pageComponentName(page)}() {
  return (
    <ScrollView style={styles.container}>
${content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
});
`;
  }
  
  private generateReactNativeComponent(component: AppComponent, componentMap: Map<string, AppComponent>, indent = 6): string {
    const spaces = " ".repeat(indent);
    
    let children = "";
    if (component.children && component.children.length > 0) {
      children = "\n" + component.children
        .map((childId) => {
          const childComponent = componentMap.get(childId as string);
          return childComponent ? this.generateReactNativeComponent(childComponent, componentMap, indent + 2) : "";
        })
        .filter(Boolean)
        .join("\n") + "\n" + spaces;
    }
    
    switch (component.type) {
      case "text":
        return `${spaces}<Text>${component.props.content || ""}</Text>`;
      
      case "button":
        return `${spaces}<TouchableOpacity><Text>${component.props.label || "Button"}</Text></TouchableOpacity>`;
      
      case "input":
        return `${spaces}<TextInput placeholder="${component.props.placeholder || ""}" />`;
      
      case "image":
        return `${spaces}<Image source={{ uri: "${component.props.src || ""}" }} />`;
      
      default:
        return `${spaces}<View>${children}</View>`;
    }
  }
  
  // ===========================================================================
  // HELPERS
  // ===========================================================================
  
  private pageComponentName(page: AppPage): string {
    return page.name.replace(/\s+/g, "") + "Page";
  }
  
  private pageFileName(page: AppPage): string {
    return page.name.replace(/\s+/g, "_").toLowerCase();
  }
  
  private stylesToCss(styles: Record<string, unknown>): string {
    return Object.entries(styles)
      .map(([key, value]) => `${this.camelToKebab(key)}: ${value}`)
      .join("; ");
  }
  
  private camelToKebab(str: string): string {
    return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  }
  
  private generateGlobalStyles(project: AppProject): string {
    // globalStyles can be a string or an object
    if (typeof project.globalStyles === "string") {
      return project.globalStyles;
    }
    
    const styles = project.globalStyles;
    const colors = styles.colors || {};
    const spacing = styles.spacing || {};
    
    return `
:root {
  --font-family: ${styles.fontFamily || "system-ui, sans-serif"};
  --color-primary: ${colors.primary || "#3b82f6"};
  --color-secondary: ${colors.secondary || "#6b7280"};
  --color-success: ${colors.success || "#10b981"};
  --color-warning: ${colors.warning || "#f59e0b"};
  --color-error: ${colors.error || "#ef4444"};
  --color-background: ${colors.background || "#ffffff"};
  --color-foreground: ${colors.foreground || "#111827"};
  --spacing-xs: ${spacing.xs || "4px"};
  --spacing-sm: ${spacing.sm || "8px"};
  --spacing-md: ${spacing.md || "16px"};
  --spacing-lg: ${spacing.lg || "24px"};
  --spacing-xl: ${spacing.xl || "32px"};
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-family);
  background-color: var(--color-background);
  color: var(--color-foreground);
}

.page {
  padding: var(--spacing-md);
}
`;
  }
  
  /**
   * Shutdown service
   */
  async shutdown(): Promise<void> {
    // No cleanup needed
  }
}

// Export singleton
export const visualAppBuilder = new VisualAppBuilder();
