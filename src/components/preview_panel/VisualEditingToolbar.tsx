import { useState, useEffect } from "react";
import { X, Move, Maximize2, Square } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComponentSelection } from "@/ipc/ipc_types";
import { useSetAtom, useAtomValue } from "jotai";
import {
  pendingVisualChangesAtom,
  selectedComponentsPreviewAtom,
  currentComponentCoordinatesAtom,
  visualEditingSelectedComponentAtom,
} from "@/atoms/previewAtoms";

interface VisualEditingToolbarProps {
  selectedComponent: ComponentSelection | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  appId: number;
}

export function VisualEditingToolbar({
  selectedComponent,
  iframeRef,
  appId,
}: VisualEditingToolbarProps) {
  const coordinates = useAtomValue(currentComponentCoordinatesAtom);
  // Visual editing current values state - using x/y axis instead of individual sides
  const [currentMargin, setCurrentMargin] = useState({ x: "", y: "" });
  const [currentPadding, setCurrentPadding] = useState({ x: "", y: "" });
  const [currentDimensions, setCurrentDimensions] = useState({
    width: "",
    height: "",
  });
  const [currentBorder, setCurrentBorder] = useState({
    width: "",
    radius: "",
    color: "#000000",
  });
  const setPendingChanges = useSetAtom(pendingVisualChangesAtom);
  const setSelectedComponentsPreview = useSetAtom(
    selectedComponentsPreviewAtom,
  );
  const setVisualEditingSelectedComponent = useSetAtom(
    visualEditingSelectedComponentAtom,
  );

  // Handle deselecting the current component
  const handleDeselectComponent = () => {
    if (!selectedComponent) return;

    // Remove from selected components atom
    setSelectedComponentsPreview((prev) =>
      prev.filter((c) => c.id !== selectedComponent.id),
    );

    setVisualEditingSelectedComponent(null);
    // Send message to iframe to remove overlay
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "remove-dyad-component-overlay",
          componentId: selectedComponent.id,
        },
        "*",
      );
    }

    // Close the sidebar
    onClose();
  };

  // Unified function to send style modifications
  const sendStyleModification = (styles: {
    margin?: { left?: string; right?: string; top?: string; bottom?: string };
    padding?: { left?: string; right?: string; top?: string; bottom?: string };
    dimensions?: { width?: string; height?: string };
    border?: { width?: string; radius?: string; color?: string };
  }) => {
    if (!iframeRef.current?.contentWindow || !selectedComponent) return;

    iframeRef.current.contentWindow.postMessage(
      {
        type: "modify-dyad-component-styles",
        data: {
          elementId: selectedComponent.id,
          styles,
        },
      },
      "*",
    );

    // Update overlay positions after style change
    iframeRef.current.contentWindow.postMessage(
      {
        type: "update-dyad-overlay-positions",
      },
      "*",
    );

    // Track changes in pending state - only store properties that were actually modified
    setPendingChanges((prev) => {
      const updated = new Map(prev);
      const existing = updated.get(selectedComponent.id);
      const newStyles: any = { ...existing?.styles };

      if (styles.margin) {
        newStyles.margin = { ...existing?.styles?.margin, ...styles.margin };
      }
      if (styles.padding) {
        newStyles.padding = { ...existing?.styles?.padding, ...styles.padding };
      }
      if (styles.dimensions) {
        newStyles.dimensions = {
          ...existing?.styles?.dimensions,
          ...styles.dimensions,
        };
      }
      if (styles.border) {
        newStyles.border = { ...existing?.styles?.border, ...styles.border };
      }

      updated.set(selectedComponent.id, {
        componentId: selectedComponent.id,
        componentName: selectedComponent.name,
        relativePath: selectedComponent.relativePath,
        lineNumber: selectedComponent.lineNumber,
        appId,
        styles: newStyles,
      });
      return updated;
    });
  };

  // Function to get current styles from selected element
  const getCurrentElementStyles = () => {
    if (!iframeRef.current?.contentWindow || !selectedComponent) return;

    try {
      // Send message to iframe to get current styles
      iframeRef.current.contentWindow.postMessage(
        {
          type: "get-dyad-component-styles",
          data: {
            elementId: selectedComponent.id,
          },
        },
        "*",
      );
    } catch (error) {
      console.error("Failed to get element styles:", error);
    }
  };

  // Get current styles when component changes
  useEffect(() => {
    if (selectedComponent) {
      getCurrentElementStyles();
    }
  }, [selectedComponent]);

  // Listen for style responses from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "dyad-component-styles") {
        const { margin, padding, dimensions, border } = event.data.data;

        // Convert individual sides to x/y axis values
        // For x/y, we use the value if left/right or top/bottom are the same, otherwise leave empty
        const marginX = margin?.left === margin?.right ? margin.left : "";
        const marginY = margin?.top === margin?.bottom ? margin.top : "";
        const paddingX = padding?.left === padding?.right ? padding.left : "";
        const paddingY = padding?.top === padding?.bottom ? padding.top : "";

        // Convert RGB color to hex for color picker compatibility
        const convertRgbToHex = (rgb: string): string => {
          if (!rgb || rgb.startsWith("#")) return rgb || "#000000";
          const rgbMatch = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
          if (rgbMatch) {
            const r = parseInt(rgbMatch[1]).toString(16).padStart(2, "0");
            const g = parseInt(rgbMatch[2]).toString(16).padStart(2, "0");
            const b = parseInt(rgbMatch[3]).toString(16).padStart(2, "0");
            return `#${r}${g}${b}`;
          }
          return rgb || "#000000";
        };

        setCurrentMargin({ x: marginX, y: marginY });
        setCurrentPadding({ x: paddingX, y: paddingY });
        setCurrentDimensions(dimensions || { width: "", height: "" });
        setCurrentBorder({
          width: border?.width || "",
          radius: border?.radius || "",
          color: convertRgbToHex(border?.color),
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Handle margin changes
  const handleMarginChange = (axis: "x" | "y", value: string) => {
    setCurrentMargin((prev) => ({ ...prev, [axis]: value }));

    if (value) {
      const processedValue = /^\d+$/.test(value) ? `${value}px` : value;
      const marginData =
        axis === "x"
          ? { left: processedValue, right: processedValue }
          : { top: processedValue, bottom: processedValue };

      sendStyleModification({ margin: marginData });
    }
  };

  // Handle padding changes
  const handlePaddingChange = (axis: "x" | "y", value: string) => {
    setCurrentPadding((prev) => ({ ...prev, [axis]: value }));

    if (value) {
      const processedValue = /^\d+$/.test(value) ? `${value}px` : value;
      const paddingData =
        axis === "x"
          ? { left: processedValue, right: processedValue }
          : { top: processedValue, bottom: processedValue };

      sendStyleModification({ padding: paddingData });
    }
  };

  // Handle dimension changes
  const handleDimensionChange = (
    property: "width" | "height",
    value: string,
  ) => {
    setCurrentDimensions((prev) => ({ ...prev, [property]: value }));

    if (value) {
      const processedValue =
        /^\d+$/.test(value) && !/%|auto|inherit|initial|unset/.test(value)
          ? `${value}px`
          : value;

      sendStyleModification({ dimensions: { [property]: processedValue } });
    }
  };

  // Handle border changes
  const handleBorderChange = (
    property: "width" | "radius" | "color",
    value: string,
  ) => {
    const newBorder = { ...currentBorder, [property]: value };
    setCurrentBorder(newBorder);

    if (value) {
      let processedValue = value;
      if (property !== "color" && /^\d+$/.test(value)) {
        processedValue = `${value}px`;
      }

      // Always send both width and color together to maintain consistency
      if (property === "width" || property === "color") {
        sendStyleModification({
          border: {
            width:
              property === "width"
                ? processedValue
                : currentBorder.width || "0px",
            color: property === "color" ? processedValue : currentBorder.color,
          },
        });
      } else {
        sendStyleModification({ border: { [property]: processedValue } });
      }
    }
  };

  if (!selectedComponent || !coordinates) return null;

  // Calculate position - place toolbar at bottom of component
  const toolbarTop = coordinates.top + coordinates.height + 4;
  const toolbarLeft = coordinates.left;

  return (
    <div
      className="absolute bg-[var(--background)] border border-[var(--border)] rounded-md shadow-lg z-50 flex flex-row items-center px-2 py-1 gap-1"
      style={{
        top: `${toolbarTop}px`,
        left: `${toolbarLeft}px`,
      }}
    >
      {/* Deselect button */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleDeselectComponent}
              className="p-1 rounded hover:bg-red-200 dark:hover:bg-red-900 text-red-600 dark:text-red-400"
            >
              <X size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Deselect Component</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Margin Control */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            style={{ color: "#7f22fe" }}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Move size={16} />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Margin</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" className="w-64">
          <div className="space-y-3">
            <h4 className="font-medium text-sm" style={{ color: "#7f22fe" }}>
              Margin
            </h4>
            <div className="grid grid-cols-1 gap-2">
              <div>
                <Label htmlFor="margin-x" className="text-xs">
                  Horizontal (X)
                </Label>
                <Input
                  id="margin-x"
                  type="number"
                  placeholder="10"
                  className="mt-1 h-8 text-xs"
                  value={currentMargin.x.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) => handleMarginChange("x", e.target.value)}
                  step="1"
                />
              </div>
              <div>
                <Label htmlFor="margin-y" className="text-xs">
                  Vertical (Y)
                </Label>
                <Input
                  id="margin-y"
                  type="number"
                  placeholder="10"
                  className="mt-1 h-8 text-xs"
                  value={currentMargin.y.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) => handleMarginChange("y", e.target.value)}
                  step="1"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Padding Control */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            style={{ color: "#7f22fe" }}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <rect x="7" y="7" width="10" height="10" rx="1" />
                  </svg>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Padding</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" className="w-64">
          <div className="space-y-3">
            <h4 className="font-medium text-sm" style={{ color: "#7f22fe" }}>
              Padding
            </h4>
            <div className="grid grid-cols-1 gap-2">
              <div>
                <Label htmlFor="padding-x" className="text-xs">
                  Horizontal (X)
                </Label>
                <Input
                  id="padding-x"
                  type="number"
                  placeholder="10"
                  className="mt-1 h-8 text-xs"
                  value={currentPadding.x.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) => handlePaddingChange("x", e.target.value)}
                  step="1"
                  min="0"
                />
              </div>
              <div>
                <Label htmlFor="padding-y" className="text-xs">
                  Vertical (Y)
                </Label>
                <Input
                  id="padding-y"
                  type="number"
                  placeholder="10"
                  className="mt-1 h-8 text-xs"
                  value={currentPadding.y.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) => handlePaddingChange("y", e.target.value)}
                  step="1"
                  min="0"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Dimensions Control */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            style={{ color: "#7f22fe" }}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Maximize2 size={16} />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Dimensions</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" className="w-64">
          <div className="space-y-3">
            <h4 className="font-medium text-sm" style={{ color: "#7f22fe" }}>
              Dimensions
            </h4>
            <div className="space-y-2">
              <div>
                <Label htmlFor="width" className="text-xs">
                  Width
                </Label>
                <Input
                  id="width"
                  type="number"
                  placeholder="100"
                  className="mt-1 h-8 text-xs"
                  value={currentDimensions.width.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) =>
                    handleDimensionChange("width", e.target.value)
                  }
                  step="1"
                  min="0"
                />
              </div>
              <div>
                <Label htmlFor="height" className="text-xs">
                  Height
                </Label>
                <Input
                  id="height"
                  type="number"
                  placeholder="100"
                  className="mt-1 h-8 text-xs"
                  value={currentDimensions.height.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) =>
                    handleDimensionChange("height", e.target.value)
                  }
                  step="1"
                  min="0"
                />
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Border Control */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
            style={{ color: "#7f22fe" }}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Square size={16} />
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Border</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </button>
        </PopoverTrigger>
        <PopoverContent side="bottom" className="w-64">
          <div className="space-y-3">
            <h4 className="font-medium text-sm" style={{ color: "#7f22fe" }}>
              Border
            </h4>
            <div className="space-y-2">
              <div>
                <Label htmlFor="border-width" className="text-xs">
                  Width
                </Label>
                <Input
                  id="border-width"
                  type="number"
                  placeholder="1"
                  className="mt-1 h-8 text-xs"
                  value={currentBorder.width.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) => handleBorderChange("width", e.target.value)}
                  step="1"
                  min="0"
                />
              </div>
              <div>
                <Label htmlFor="border-radius" className="text-xs">
                  Radius
                </Label>
                <Input
                  id="border-radius"
                  type="number"
                  placeholder="4"
                  className="mt-1 h-8 text-xs"
                  value={currentBorder.radius.replace(/[^\d.-]/g, "") || ""}
                  onChange={(e) => handleBorderChange("radius", e.target.value)}
                  step="1"
                  min="0"
                />
              </div>
              <div>
                <Label htmlFor="border-color" className="text-xs">
                  Color
                </Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="border-color"
                    type="color"
                    className="h-8 w-12 p-1 cursor-pointer"
                    value={currentBorder.color}
                    onChange={(e) =>
                      handleBorderChange("color", e.target.value)
                    }
                  />
                  <Input
                    type="text"
                    placeholder="#000000"
                    className="h-8 text-xs flex-1"
                    value={currentBorder.color}
                    onChange={(e) =>
                      handleBorderChange("color", e.target.value)
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
