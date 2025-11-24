import { useState, useEffect } from "react";
import { X, Move, Maximize2, Square, Palette, Type } from "lucide-react";
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
  isDynamic: boolean;
  hasStaticText: boolean;
}

export function VisualEditingToolbar({
  selectedComponent,
  iframeRef,
  appId,
  isDynamic,
  hasStaticText,
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
  const [currentBackgroundColor, setCurrentBackgroundColor] =
    useState("#ffffff");
  const [currentTextStyles, setCurrentTextStyles] = useState({
    fontSize: "",
    fontWeight: "",
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

    setVisualEditingSelectedComponent(null);
  };

  // Unified function to send style modifications
  const sendStyleModification = (styles: {
    margin?: { left?: string; right?: string; top?: string; bottom?: string };
    padding?: { left?: string; right?: string; top?: string; bottom?: string };
    dimensions?: { width?: string; height?: string };
    border?: { width?: string; radius?: string; color?: string };
    backgroundColor?: string;
    text?: { fontSize?: string; fontWeight?: string; color?: string };
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
      if (styles.backgroundColor) {
        newStyles.backgroundColor = styles.backgroundColor;
      }
      if (styles.text) {
        newStyles.text = { ...existing?.styles?.text, ...styles.text };
      }

      updated.set(selectedComponent.id, {
        componentId: selectedComponent.id,
        componentName: selectedComponent.name,
        relativePath: selectedComponent.relativePath,
        lineNumber: selectedComponent.lineNumber,
        appId,
        styles: newStyles,
        textContent: existing?.textContent || "",
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

  // Send component coordinates to iframe for toolbar hover detection
  useEffect(() => {
    if (coordinates && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "update-component-coordinates",
          coordinates,
        },
        "*",
      );
    }
  }, [coordinates, iframeRef]);

  // Listen for style responses from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "dyad-component-styles") {
        const { margin, padding, dimensions, border, backgroundColor, text } =
          event.data.data;

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
        setCurrentBackgroundColor(
          convertRgbToHex(backgroundColor) || "#ffffff",
        );
        setCurrentTextStyles({
          fontSize: text?.fontSize || "",
          fontWeight: text?.fontWeight || "",
          color: convertRgbToHex(text?.color) || "#000000",
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

  // Handle background color changes
  const handleBackgroundColorChange = (value: string) => {
    setCurrentBackgroundColor(value);
    if (value) {
      sendStyleModification({ backgroundColor: value });
    }
  };

  // Handle text style changes
  const handleTextStyleChange = (
    property: "fontSize" | "fontWeight" | "color",
    value: string,
  ) => {
    setCurrentTextStyles((prev) => ({ ...prev, [property]: value }));

    if (value) {
      let processedValue = value;

      // Add px to fontSize if it's just a number
      if (property === "fontSize" && /^\d+$/.test(value)) {
        processedValue = `${value}px`;
      }

      sendStyleModification({ text: { [property]: processedValue } });
    }
  };

  if (!selectedComponent || !coordinates) return null;

  // Calculate position - place toolbar at bottom of component
  const toolbarTop = coordinates.top + coordinates.height + 4;
  const toolbarLeft = coordinates.left;

  return (
    <div
      className="absolute bg-[var(--background)] border border-[var(--border)] rounded-md shadow-lg z-50 flex flex-row items-center p-2 gap-1"
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
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-[#7f22fe] dark:text-gray-200"
            >
              <X size={16} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Deselect Component</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {isDynamic ? (
        <div className="flex items-center px-2 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded text-xs font-medium">
          <span>This component is styled dynamically</span>
        </div>
      ) : (
        <>
          {/* Margin Control */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-[#7f22fe] dark:text-gray-200">
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
                <h4
                  className="font-medium text-sm"
                  style={{ color: "#7f22fe" }}
                >
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
              <button className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-[#7f22fe] dark:text-gray-200">
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
                <h4
                  className="font-medium text-sm"
                  style={{ color: "#7f22fe" }}
                >
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
              <button className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-[#7f22fe] dark:text-gray-200">
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
                <h4
                  className="font-medium text-sm"
                  style={{ color: "#7f22fe" }}
                >
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
                      value={
                        currentDimensions.width.replace(/[^\d.-]/g, "") || ""
                      }
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
                      value={
                        currentDimensions.height.replace(/[^\d.-]/g, "") || ""
                      }
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
              <button className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-[#7f22fe] dark:text-gray-200">
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
                <h4
                  className="font-medium text-sm"
                  style={{ color: "#7f22fe" }}
                >
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
                      onChange={(e) =>
                        handleBorderChange("width", e.target.value)
                      }
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
                      onChange={(e) =>
                        handleBorderChange("radius", e.target.value)
                      }
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

          {/* Background Color Control */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-[#7f22fe] dark:text-gray-200">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Palette size={16} />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p>Background</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" className="w-64">
              <div className="space-y-3">
                <h4
                  className="font-medium text-sm"
                  style={{ color: "#7f22fe" }}
                >
                  Background Color
                </h4>
                <div>
                  <Label htmlFor="bg-color" className="text-xs">
                    Color
                  </Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      id="bg-color"
                      type="color"
                      className="h-8 w-12 p-1 cursor-pointer"
                      value={currentBackgroundColor}
                      onChange={(e) =>
                        handleBackgroundColorChange(e.target.value)
                      }
                    />
                    <Input
                      type="text"
                      placeholder="#ffffff"
                      className="h-8 text-xs flex-1"
                      value={currentBackgroundColor}
                      onChange={(e) =>
                        handleBackgroundColorChange(e.target.value)
                      }
                    />
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Text Styling Control - only show if component has static text */}
          {hasStaticText && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-[#7f22fe] dark:text-gray-200">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Type size={16} />
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p>Text Style</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </button>
              </PopoverTrigger>
              <PopoverContent side="bottom" className="w-64">
                <div className="space-y-3">
                  <h4
                    className="font-medium text-sm"
                    style={{ color: "#7f22fe" }}
                  >
                    Text Style
                  </h4>
                  <div className="space-y-2">
                    <div>
                      <Label htmlFor="font-size" className="text-xs">
                        Font Size
                      </Label>
                      <Input
                        id="font-size"
                        type="number"
                        placeholder="16"
                        className="mt-1 h-8 text-xs"
                        value={
                          currentTextStyles.fontSize.replace(/[^\d.-]/g, "") ||
                          ""
                        }
                        onChange={(e) =>
                          handleTextStyleChange("fontSize", e.target.value)
                        }
                        step="1"
                        min="0"
                      />
                    </div>
                    <div>
                      <Label htmlFor="font-weight" className="text-xs">
                        Font Weight
                      </Label>
                      <select
                        id="font-weight"
                        className="mt-1 h-8 text-xs w-full rounded-md border border-input bg-background px-3 py-2"
                        value={currentTextStyles.fontWeight}
                        onChange={(e) =>
                          handleTextStyleChange("fontWeight", e.target.value)
                        }
                      >
                        <option value="">Default</option>
                        <option value="100">Thin (100)</option>
                        <option value="200">Extra Light (200)</option>
                        <option value="300">Light (300)</option>
                        <option value="400">Normal (400)</option>
                        <option value="500">Medium (500)</option>
                        <option value="600">Semi Bold (600)</option>
                        <option value="700">Bold (700)</option>
                        <option value="800">Extra Bold (800)</option>
                        <option value="900">Black (900)</option>
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="text-color" className="text-xs">
                        Text Color
                      </Label>
                      <div className="flex gap-2 mt-1">
                        <Input
                          id="text-color"
                          type="color"
                          className="h-8 w-12 p-1 cursor-pointer"
                          value={currentTextStyles.color}
                          onChange={(e) =>
                            handleTextStyleChange("color", e.target.value)
                          }
                        />
                        <Input
                          type="text"
                          placeholder="#000000"
                          className="h-8 text-xs flex-1"
                          value={currentTextStyles.color}
                          onChange={(e) =>
                            handleTextStyleChange("color", e.target.value)
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </>
      )}
    </div>
  );
}
