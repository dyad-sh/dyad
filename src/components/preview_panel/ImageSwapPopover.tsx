import { useState, useRef, useEffect } from "react";
import { ImageIcon, Upload, Link, Check } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StylePopover } from "./StylePopover";

export interface ImageUploadData {
  fileName: string;
  base64Data: string;
  mimeType: string;
}

interface ImageSwapPopoverProps {
  currentSrc: string;
  onSwap: (newSrc: string, uploadData?: ImageUploadData) => void;
}

const VALID_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export function ImageSwapPopover({
  currentSrc,
  onSwap,
}: ImageSwapPopoverProps) {
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [urlValue, setUrlValue] = useState(currentSrc);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync urlValue when a different component is selected
  useEffect(() => {
    setUrlValue(currentSrc);
    setSelectedFileName(null);
    setFileError(null);
    setUrlError(null);
  }, [currentSrc]);

  const handleUrlSubmit = () => {
    const trimmed = urlValue.trim();
    if (!trimmed) {
      setUrlError("Please enter a URL.");
      return;
    }
    // Accept absolute URLs (http/https/protocol-relative) and root-relative paths
    if (
      !/^https?:\/\//i.test(trimmed) &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("/")
    ) {
      setUrlError(
        "Please enter a valid URL (https://...) or an absolute path (/...).",
      );
      return;
    }
    setUrlError(null);
    onSwap(trimmed);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      setFileError("Unsupported file type. Please use JPG, PNG, GIF, or WebP.");
      return;
    }
    setFileError(null);

    setSelectedFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const base64DataUrl = reader.result as string;

      // The backend will generate the final unique filename.
      // We just need a placeholder path for the pending change.
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const newSrc = `/images/${sanitizedName}`;

      onSwap(newSrc, {
        fileName: file.name,
        base64Data: base64DataUrl,
        mimeType: file.type,
      });
    };
    reader.onerror = () => {
      setFileError(
        "Failed to read the file. Please try again or choose a different file.",
      );
      setSelectedFileName(null);
    };
    reader.readAsDataURL(file);

    // Clear input so same file can be selected again
    e.target.value = "";
  };

  return (
    <StylePopover
      icon={<ImageIcon size={16} />}
      title="Image Source"
      tooltip="Swap Image"
    >
      <div className="space-y-3">
        {/* Mode toggle tabs */}
        <Tabs
          value={mode}
          onValueChange={(val) => setMode(val as "url" | "upload")}
        >
          <TabsList className="w-full h-8">
            <TabsTrigger value="url" className="flex-1 gap-1 text-xs">
              <Link size={12} />
              URL
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex-1 gap-1 text-xs">
              <Upload size={12} />
              Upload
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "url" ? (
          <div className="space-y-2">
            <Label htmlFor="image-url" className="text-xs">
              Image URL
            </Label>
            <Input
              id="image-url"
              type="text"
              placeholder="https://example.com/image.png"
              className="h-8 text-xs"
              value={urlValue}
              onChange={(e) => {
                setUrlValue(e.target.value);
                setUrlError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUrlSubmit();
              }}
            />
            {urlError && <p className="text-xs text-red-500">{urlError}</p>}
            <Button size="sm" onClick={handleUrlSubmit} className="w-full">
              <Check size={14} className="mr-1" />
              Apply
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs">Upload Image</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
            >
              <Upload size={14} className="mr-1 shrink-0" />
              <span className="truncate">
                {selectedFileName || "Choose File"}
              </span>
            </Button>
            {fileError && <p className="text-xs text-red-500">{fileError}</p>}
            <p className="text-xs text-gray-500">
              Supports: JPG, PNG, GIF, WebP
            </p>
          </div>
        )}

        {/* Current source display */}
        <div className="pt-2 border-t">
          <Label className="text-xs text-gray-500">Current source</Label>
          <p className="text-xs font-mono truncate mt-1" title={currentSrc}>
            {currentSrc || "none"}
          </p>
        </div>
      </div>
    </StylePopover>
  );
}
