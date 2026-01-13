import { useState, useEffect } from "react";
import { X, Move, Square, Palette, Type } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ComponentSelection } from "@/ipc/ipc_types";
import { useSetAtom, useAtomValue } from "jotai";
import {
  pendingVisualChangesAtom,
  selectedComponentsPreviewAtom,
  currentComponentCoordinatesAtom,
  visualEditingSelectedComponentAtom,
} from "@/atoms/previewAtoms";
import { StylePopover } from "./StylePopover";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { NumberInput } from "@/components/ui/NumberInput";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { rgbToHex, processNumericValue } from "@/utils/style-utils";

const FONT_WEIGHT_OPTIONS = [
  { value: "", label: "Default" },
  { value: "100", label: "Thin (100)" },
  { value: "200", label: "Extra Light (200)" },
  { value: "300", label: "Light (300)" },
  { value: "400", label: "Normal (400)" },
  { value: "500", label: "Medium (500)" },
  { value: "600", label: "Semi Bold (600)" },
  { value: "700", label: "Bold (700)" },
  { value: "800", label: "Extra Bold (800)" },
  { value: "900", label: "Black (900)" },
] as const;

const FONT_FAMILY_OPTIONS = [
  { value: "", label: "Default" },
  // Sans-serif (clean, modern)
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Inter, sans-serif", label: "Inter" },
  { value: "Roboto, sans-serif", label: "Roboto" },
  // Serif (traditional, elegant)
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "Merriweather, serif", label: "Merriweather" },
  // Monospace (code, technical)
  { value: "'Courier New', Courier, monospace", label: "Courier New" },
  { value: "'Fira Code', monospace", label: "Fira Code" },
  { value: "Consolas, monospace", label: "Consolas" },
  // Display/Decorative (bold, distinctive)
  { value: "Impact, fantasy", label: "Impact" },
  { value: "'Bebas Neue', cursive", label: "Bebas Neue" },
  // Cursive/Handwriting (casual, friendly)
  { value: "'Comic Sans MS', cursive", label: "Comic Sans MS" },
  { value: "'Brush Script MT', cursive", label: "Brush Script" },
] as const;

interface VisualEditingToolbarProps {
  selectedComponent: ComponentSelection | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  isDynamic: boolean;
  hasStaticText: boolean;
}

export function VisualEditingToolbar({
  selectedComponent,
  iframeRef,
  isDynamic,
  hasStaticText,
}: VisualEditingToolbarProps) {
  const coordinates = useAtomValue(currentComponentCoordinatesAtom);
  const [currentMargin, setCurrentMargin] = useState({ x: "", y: "" });
  const [currentPadding, setCurrentPadding] = useState({ x: "", y: "" });
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
    fontFamily: "",
    color: "#000000",
  });
  const setPendingChanges = useSetAtom(pendingVisualChangesAtom);
  const setSelectedComponentsPreview = useSetAtom(
    selectedComponentsPreviewAtom,
  );
  const setVisualEditingSelectedComponent = useSetAtom(
    visualEditingSelectedComponentAtom,
  );

  const handleDeselectComponent = () => {
    if (!selectedComponent) return;

    setSelectedComponentsPreview((prev) =>
      prev.filter((c) => c.id !== selectedComponent.id),
    );
    setVisualEditingSelectedComponent(null);

    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "remove-dyad-component-overlay",
          componentId: selectedComponent.id,
        },
        "*",
      );
    }
  };

  const sendStyleModification = (styles: {
    margin?: { left?: string; right?: string; top?: string; bottom?: string };
    padding?: { left?: string; right?: string; top?: string; bottom?: string };

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
          runtimeId: selectedComponent.runtimeId,
          styles,
        },
      },
      "*",
    );

    iframeRef.current.contentWindow.postMessage(
      {
        type: "update-dyad-overlay-positions",
      },
      "*",
    );

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
        styles: newStyles,
        textContent: existing?.textContent || "",
      });
      return updated;
    });
  };

  const getCurrentElementStyles = () => {
    if (!iframeRef.current?.contentWindow || !selectedComponent) return;

    try {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "get-dyad-component-styles",
          data: {
            elementId: selectedComponent.id,
            runtimeId: selectedComponent.runtimeId,
          },
        },
        "*",
      );
    } catch (error) {
      console.error("Failed to get element styles:", error);
    }
  };

  useEffect(() => {
    if (selectedComponent) {
      getCurrentElementStyles();
    }
  }, [selectedComponent]);

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

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "dyad-component-styles") {
        const { margin, padding, border, backgroundColor, text } =
          event.data.data;

        const marginX = margin?.left === margin?.right ? margin.left : "";
        const marginY = margin?.top === margin?.bottom ? margin.top : "";
        const paddingX = padding?.left === padding?.right ? padding.left : "";
        const paddingY = padding?.top === padding?.bottom ? padding.top : "";

        setCurrentMargin({ x: marginX, y: marginY });
        setCurrentPadding({ x: paddingX, y: paddingY });
        setCurrentBorder({
          width: border?.width || "",
          radius: border?.radius || "",
          color: rgbToHex(border?.color),
        });
        setCurrentBackgroundColor(rgbToHex(backgroundColor) || "#ffffff");
        setCurrentTextStyles({
          fontSize: text?.fontSize || "",
          fontWeight: text?.fontWeight || "",
          fontFamily: text?.fontFamily || "",
          color: rgbToHex(text?.color) || "#000000",
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleSpacingChange = (
    type: "margin" | "padding",
    axis: "x" | "y",
    value: string,
  ) => {
    const setter = type === "margin" ? setCurrentMargin : setCurrentPadding;
    setter((prev) => ({ ...prev, [axis]: value }));

    if (value) {
      const processedValue = processNumericValue(value);
      const data =
        axis === "x"
          ? { left: processedValue, right: processedValue }
          : { top: processedValue, bottom: processedValue };

      sendStyleModification({ [type]: data });
    }
  };

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

  const handleTextStyleChange = (
    property: "fontSize" | "fontWeight" | "fontFamily" | "color",
    value: string,
  ) => {
    setCurrentTextStyles((prev) => ({ ...prev, [property]: value }));

    if (value) {
      let processedValue = value;
      if (property === "fontSize" && /^\d+$/.test(value)) {
        processedValue = `${value}px`;
      }

      sendStyleModification({ text: { [property]: processedValue } });
    }
  };

  if (!selectedComponent || !coordinates) return null;

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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleDeselectComponent}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-[#7f22fe] dark:text-gray-200"
              aria-label="Deselect Component"
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
        <div className="flex items-center px-2 py-1 text-yellow-800 dark:text-yellow-200 rounded text-xs font-medium">
          <span>This component is styled dynamically</span>
        </div>
      ) : (
        <>
          <StylePopover
            icon={<Move size={16} />}
            title="Margin"
            tooltip="Margin"
          >
            <div className="grid grid-cols-1 gap-2">
              <NumberInput
                id="margin-x"
                label="Horizontal"
                value={currentMargin.x}
                onChange={(v) => handleSpacingChange("margin", "x", v)}
                placeholder="10"
              />
              <NumberInput
                id="margin-y"
                label="Vertical"
                value={currentMargin.y}
                onChange={(v) => handleSpacingChange("margin", "y", v)}
                placeholder="10"
              />
            </div>
          </StylePopover>

          <StylePopover
            icon={
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
            }
            title="Padding"
            tooltip="Padding"
          >
            <div className="grid grid-cols-1 gap-2">
              <NumberInput
                id="padding-x"
                label="Horizontal"
                value={currentPadding.x}
                onChange={(v) => handleSpacingChange("padding", "x", v)}
                placeholder="10"
              />
              <NumberInput
                id="padding-y"
                label="Vertical"
                value={currentPadding.y}
                onChange={(v) => handleSpacingChange("padding", "y", v)}
                placeholder="10"
              />
            </div>
          </StylePopover>

          <StylePopover
            icon={<Square size={16} />}
            title="Border"
            tooltip="Border"
          >
            <div className="space-y-2">
              <NumberInput
                id="border-width"
                label="Width"
                value={currentBorder.width}
                onChange={(v) => handleBorderChange("width", v)}
                placeholder="1"
              />
              <NumberInput
                id="border-radius"
                label="Radius"
                value={currentBorder.radius}
                onChange={(v) => handleBorderChange("radius", v)}
                placeholder="4"
              />
              <div>
                <Label htmlFor="border-color" className="text-xs">
                  Color
                </Label>
                <ColorPicker
                  id="border-color"
                  value={currentBorder.color}
                  onChange={(v) => handleBorderChange("color", v)}
                  className="mt-1"
                />
              </div>
            </div>
          </StylePopover>

          <StylePopover
            icon={<Palette size={16} />}
            title="Background Color"
            tooltip="Background"
          >
            <div>
              <Label htmlFor="bg-color" className="text-xs">
                Color
              </Label>
              <ColorPicker
                id="bg-color"
                value={currentBackgroundColor}
                onChange={(v) => {
                  setCurrentBackgroundColor(v);
                  if (v) sendStyleModification({ backgroundColor: v });
                }}
                className="mt-1"
              />
            </div>
          </StylePopover>

          {hasStaticText && (
            <StylePopover
              icon={<Type size={16} />}
              title="Text Style"
              tooltip="Text Style"
            >
              <div className="space-y-2">
                <NumberInput
                  id="font-size"
                  label="Font Size"
                  value={currentTextStyles.fontSize}
                  onChange={(v) => handleTextStyleChange("fontSize", v)}
                  placeholder="16"
                />
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
                    {FONT_WEIGHT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="font-family" className="text-xs">
                    Font Family
                  </Label>
                  <select
                    id="font-family"
                    className="mt-1 h-8 text-xs w-full rounded-md border border-input bg-background px-3 py-2"
                    value={currentTextStyles.fontFamily}
                    onChange={(e) =>
                      handleTextStyleChange("fontFamily", e.target.value)
                    }
                  >
                    {FONT_FAMILY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="text-color" className="text-xs">
                    Text Color
                  </Label>
                  <ColorPicker
                    id="text-color"
                    value={currentTextStyles.color}
                    onChange={(v) => handleTextStyleChange("color", v)}
                    className="mt-1"
                  />
                </div>
              </div>
            </StylePopover>
          )}
        </>
      )}
    </div>
  );
}
