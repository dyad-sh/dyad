/**
 * Design System Generator Page
 * Create and manage component libraries with AI assistance
 */

import { useState } from "react";
import { useDesignSystemGenerator } from "@/hooks/useDesignSystem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Palette,
  Plus,
  Trash2,
  Download,
  Play,
  Loader2,
  Component,
  Settings,
  Code2,
  Eye,
  FileText,
  Box,
  Layers,
  CheckCircle2,
  AlertCircle,
  PenTool,
} from "lucide-react";
import type {
  DesignSystem,
  DesignSystemId,
  ComponentType,
  StyleFramework,
  ComponentFramework,
  GenerateSystemParams,
  GenerateComponentParams,
  ExportOptions,
} from "@/ipc/design_system_client";

const STYLE_FRAMEWORKS: { value: StyleFramework; label: string }[] = [
  { value: "tailwind", label: "Tailwind CSS" },
  { value: "css", label: "CSS" },
  { value: "scss", label: "SCSS" },
  { value: "styled-components", label: "Styled Components" },
  { value: "emotion", label: "Emotion" },
  { value: "vanilla-extract", label: "Vanilla Extract" },
];

const COMPONENT_FRAMEWORKS: { value: ComponentFramework; label: string }[] = [
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
  { value: "svelte", label: "Svelte" },
  { value: "solid", label: "SolidJS" },
  { value: "angular", label: "Angular" },
  { value: "web-components", label: "Web Components" },
];

const COMPONENT_TYPES: { value: ComponentType; label: string; icon: React.ReactNode }[] = [
  { value: "button", label: "Button", icon: <Box className="h-4 w-4" /> },
  { value: "input", label: "Input", icon: <PenTool className="h-4 w-4" /> },
  { value: "card", label: "Card", icon: <Layers className="h-4 w-4" /> },
  { value: "modal", label: "Modal", icon: <Layers className="h-4 w-4" /> },
  { value: "table", label: "Table", icon: <Layers className="h-4 w-4" /> },
  { value: "navigation", label: "Navigation", icon: <Layers className="h-4 w-4" /> },
  { value: "layout", label: "Layout", icon: <Layers className="h-4 w-4" /> },
  { value: "form", label: "Form", icon: <FileText className="h-4 w-4" /> },
  { value: "display", label: "Display", icon: <Eye className="h-4 w-4" /> },
  { value: "feedback", label: "Feedback", icon: <AlertCircle className="h-4 w-4" /> },
  { value: "custom", label: "Custom", icon: <Component className="h-4 w-4" /> },
];

export default function DesignSystemPage() {
  const {
    initialized,
    systems,
    selectedSystem,
    selectedSystemId,
    setSelectedSystemId,
    createSystem,
    generateSystem,
    deleteSystem,
    generateComponent,
    exportSystem,
    isLoadingSystems,
    isCreating,
    isGenerating,
    isExporting,
  } = useDesignSystemGenerator();

  const [showNewSystemDialog, setShowNewSystemDialog] = useState(false);
  const [showNewComponentDialog, setShowNewComponentDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  if (!initialized) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Palette className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Design System Generator</h1>
            <p className="text-sm text-muted-foreground">
              Create component libraries with consistent tokens and styles
            </p>
          </div>
        </div>
        <Button onClick={() => setShowNewSystemDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Design System
        </Button>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-4 gap-6 min-h-0">
        {/* Sidebar - System List */}
        <div className="col-span-1">
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Design Systems</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-2">
                  {isLoadingSystems ? (
                    <div className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                    </div>
                  ) : systems.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Palette className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No design systems yet</p>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setShowNewSystemDialog(true)}
                      >
                        Create your first one
                      </Button>
                    </div>
                  ) : (
                    systems.map((system) => (
                      <SystemCard
                        key={system.id}
                        system={system}
                        selected={selectedSystemId === system.id}
                        onSelect={() => setSelectedSystemId(system.id)}
                        onDelete={() => deleteSystem(system.id)}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Main Panel - System Details */}
        <div className="col-span-3">
          {selectedSystem ? (
            <SystemDetails
              system={selectedSystem}
              onGenerate={() => generateSystem(selectedSystem.id)}
              onExport={() => setShowExportDialog(true)}
              onAddComponent={() => setShowNewComponentDialog(true)}
              isGenerating={isGenerating}
            />
          ) : (
            <Card className="h-full flex items-center justify-center">
              <div className="text-center">
                <Palette className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No System Selected</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Select a design system or create a new one
                </p>
                <Button onClick={() => setShowNewSystemDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Design System
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* New System Dialog */}
      <NewSystemDialog
        open={showNewSystemDialog}
        onOpenChange={setShowNewSystemDialog}
        onCreate={async (params) => {
          const system = await createSystem(params);
          setSelectedSystemId(system.id);
          setShowNewSystemDialog(false);
        }}
        isCreating={isCreating}
      />

      {/* New Component Dialog */}
      {selectedSystem && (
        <NewComponentDialog
          open={showNewComponentDialog}
          onOpenChange={setShowNewComponentDialog}
          systemId={selectedSystem.id}
          onCreate={async (params) => {
            await generateComponent(params);
            setShowNewComponentDialog(false);
          }}
        />
      )}

      {/* Export Dialog */}
      {selectedSystem && (
        <ExportDialog
          open={showExportDialog}
          onOpenChange={setShowExportDialog}
          system={selectedSystem}
          onExport={async (options) => {
            await exportSystem(selectedSystem.id, options);
            setShowExportDialog(false);
          }}
          isExporting={isExporting}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SUB-COMPONENTS
// ---------------------------------------------------------------------------

function SystemCard({
  system,
  selected,
  onSelect,
  onDelete,
}: {
  system: DesignSystem;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const statusColors = {
    draft: "bg-gray-500",
    generating: "bg-yellow-500",
    ready: "bg-green-500",
    error: "bg-red-500",
  };

  return (
    <div
      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
        selected ? "border-primary bg-primary/5" : "hover:border-muted-foreground/50"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{system.name}</span>
            <Badge variant="outline" className={`${statusColors[system.status]} text-white text-xs`}>
              {system.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1">{system.description}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Component className="h-3 w-3" />
            <span>{system.components.length} components</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function SystemDetails({
  system,
  onGenerate,
  onExport,
  onAddComponent,
  isGenerating,
}: {
  system: DesignSystem;
  onGenerate: () => void;
  onExport: () => void;
  onAddComponent: () => void;
  isGenerating: boolean;
}) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>{system.name}</CardTitle>
          <CardDescription>{system.description}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {system.status === "draft" && (
            <Button onClick={onGenerate} disabled={isGenerating}>
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Generate
            </Button>
          )}
          <Button variant="outline" onClick={onExport} disabled={system.status !== "ready"}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" onClick={onAddComponent}>
            <Plus className="h-4 w-4 mr-2" />
            Add Component
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <Tabs defaultValue="components" className="h-full flex flex-col">
          <TabsList>
            <TabsTrigger value="components">
              <Component className="h-4 w-4 mr-2" />
              Components
            </TabsTrigger>
            <TabsTrigger value="tokens">
              <Palette className="h-4 w-4 mr-2" />
              Tokens
            </TabsTrigger>
            <TabsTrigger value="config">
              <Settings className="h-4 w-4 mr-2" />
              Config
            </TabsTrigger>
          </TabsList>

          <TabsContent value="components" className="flex-1 mt-4 overflow-auto">
            {system.components.length === 0 ? (
              <div className="text-center py-12">
                <Component className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-muted-foreground mb-4">No components generated yet</p>
                {system.status === "draft" && (
                  <Button onClick={onGenerate}>
                    <Play className="h-4 w-4 mr-2" />
                    Generate Base Components
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {system.components.map((component) => (
                  <ComponentCard key={component.id} component={component} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="tokens" className="flex-1 mt-4 overflow-auto">
            <TokensView tokens={system.tokens} />
          </TabsContent>

          <TabsContent value="config" className="flex-1 mt-4 overflow-auto">
            <ConfigView config={system.config} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ComponentCard({ component }: { component: DesignSystem["components"][0] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{component.name}</CardTitle>
          <Badge variant="outline">{component.type}</Badge>
        </div>
        <CardDescription className="text-xs">{component.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{component.variants.length} variants</span>
          <span>•</span>
          <span>{component.props.length} props</span>
        </div>
      </CardContent>
    </Card>
  );
}

function TokensView({ tokens }: { tokens: DesignSystem["tokens"] }) {
  return (
    <div className="space-y-6">
      {/* Colors */}
      <div>
        <h3 className="font-medium mb-3">Colors</h3>
        <div className="grid grid-cols-4 gap-4">
          {Object.entries(tokens.colors).slice(0, 4).map(([name, scale]) => (
            <div key={name}>
              <p className="text-sm font-medium capitalize mb-2">{name}</p>
              {typeof scale === "object" && !Array.isArray(scale) && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(scale).map(([shade, color]) => (
                    <div
                      key={shade}
                      className="w-6 h-6 rounded"
                      style={{ backgroundColor: color as string }}
                      title={`${name}-${shade}: ${color}`}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* Typography */}
      <div>
        <h3 className="font-medium mb-3">Typography</h3>
        <div className="space-y-2">
          {Object.entries(tokens.typography.fontSizes).map(([size, value]) => (
            <div key={size} className="flex items-center gap-4">
              <span className="w-12 text-sm text-muted-foreground">{size}</span>
              <span style={{ fontSize: value }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* Spacing */}
      <div>
        <h3 className="font-medium mb-3">Spacing</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(tokens.spacing).map(([key, value]) => (
            <div key={key} className="text-center">
              <div
                className="bg-primary/20 rounded"
                style={{ width: value, height: value, minWidth: "8px", minHeight: "8px" }}
              />
              <span className="text-xs text-muted-foreground">{key}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConfigView({ config }: { config: DesignSystem["config"] }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-muted-foreground">Style Framework</Label>
          <p className="font-medium capitalize">{config.styleFramework}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Component Framework</Label>
          <p className="font-medium capitalize">{config.componentFramework}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">TypeScript</Label>
          <p className="font-medium">{config.typescript ? "Yes" : "No"}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Dark Mode</Label>
          <p className="font-medium">{config.darkMode ? "Yes" : "No"}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Responsive</Label>
          <p className="font-medium">{config.responsive ? "Yes" : "No"}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Accessibility</Label>
          <p className="font-medium">{config.accessibility ? "Yes" : "No"}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Storybook</Label>
          <p className="font-medium">{config.storybook ? "Yes" : "No"}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Testing</Label>
          <p className="font-medium">{config.testing ? "Yes" : "No"}</p>
        </div>
      </div>
    </div>
  );
}

function NewSystemDialog({
  open,
  onOpenChange,
  onCreate,
  isCreating,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (params: GenerateSystemParams) => Promise<void>;
  isCreating: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [styleFramework, setStyleFramework] = useState<StyleFramework>("tailwind");
  const [componentFramework, setComponentFramework] = useState<ComponentFramework>("react");
  const [typescript, setTypeScript] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [storybook, setStorybook] = useState(true);
  const [testing, setTesting] = useState(true);
  const [primaryColor, setPrimaryColor] = useState("#3b82f6");

  const handleCreate = async () => {
    await onCreate({
      name,
      description,
      brandColors: { primary: primaryColor },
      config: {
        styleFramework,
        componentFramework,
        typescript,
        darkMode,
        responsive: true,
        accessibility: true,
        storybook,
        testing,
      },
    });
    // Reset form
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Design System</DialogTitle>
          <DialogDescription>Create a new design system with customized tokens and components</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              placeholder="My Design System"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="A modern design system for web applications..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Style Framework</Label>
              <Select value={styleFramework} onValueChange={(v) => setStyleFramework(v as StyleFramework)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STYLE_FRAMEWORKS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Component Framework</Label>
              <Select value={componentFramework} onValueChange={(v) => setComponentFramework(v as ComponentFramework)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPONENT_FRAMEWORKS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Primary Color</Label>
            <div className="flex gap-2">
              <Input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-16 h-10 p-1"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="flex-1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between">
              <Label>TypeScript</Label>
              <Switch checked={typescript} onCheckedChange={setTypeScript} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Dark Mode</Label>
              <Switch checked={darkMode} onCheckedChange={setDarkMode} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Storybook</Label>
              <Switch checked={storybook} onCheckedChange={setStorybook} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Testing</Label>
              <Switch checked={testing} onCheckedChange={setTesting} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || isCreating}>
            {isCreating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Create Design System
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewComponentDialog({
  open,
  onOpenChange,
  systemId,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  systemId: DesignSystemId;
  onCreate: (params: GenerateComponentParams) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ComponentType>("button");
  const [description, setDescription] = useState("");

  const handleCreate = async () => {
    await onCreate({
      systemId,
      type,
      name,
      description,
    });
    setName("");
    setDescription("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Component</DialogTitle>
          <DialogDescription>Add a new component to the design system</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Component Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ComponentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPONENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex items-center gap-2">
                      {t.icon}
                      {t.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              placeholder="PrimaryButton"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              placeholder="A primary action button with hover effects..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim()}>
            Generate Component
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportDialog({
  open,
  onOpenChange,
  system,
  onExport,
  isExporting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  system: DesignSystem;
  onExport: (options: ExportOptions) => Promise<void>;
  isExporting: boolean;
}) {
  const [outputDir, setOutputDir] = useState(`./design-systems/${system.name.toLowerCase().replace(/\s+/g, "-")}`);
  const [includeStorybook, setIncludeStorybook] = useState(system.config.storybook);
  const [includeTests, setIncludeTests] = useState(system.config.testing);
  const [includeDocs, setIncludeDocs] = useState(true);
  const [format, setFormat] = useState<"individual" | "monorepo" | "package">("package");

  const handleExport = async () => {
    await onExport({
      outputDir,
      includeStorybook,
      includeTests,
      includeDocs,
      format,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export Design System</DialogTitle>
          <DialogDescription>Export "{system.name}" to a standalone package</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Output Directory</Label>
            <Input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="package">NPM Package</SelectItem>
                <SelectItem value="individual">Individual Files</SelectItem>
                <SelectItem value="monorepo">Monorepo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label>Include</Label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">Storybook</span>
                <Switch checked={includeStorybook} onCheckedChange={setIncludeStorybook} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Tests</span>
                <Switch checked={includeTests} onCheckedChange={setIncludeTests} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Documentation</span>
                <Switch checked={includeDocs} onCheckedChange={setIncludeDocs} />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={!outputDir.trim() || isExporting}>
            {isExporting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
