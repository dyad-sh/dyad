import { useState, useRef, useEffect } from "react";
import { ImageIcon, Upload, Link, Check } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync urlValue when a different component is selected
  useEffect(() => {
    setUrlValue(currentSrc);
    setSelectedFileName(null);
    setFileError(null);
  }, [currentSrc]);

  const handleUrlSubmit = () => {
    if (urlValue.trim()) {
      onSwap(urlValue.trim());
    }
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
        <div className="flex gap-1 border rounded-md p-0.5">
          <button
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs ${
              mode === "url"
                ? "bg-[#7f22fe] text-white"
                : "hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
            onClick={() => setMode("url")}
          >
            <Link size={12} />
            URL
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xs ${
              mode === "upload"
                ? "bg-[#7f22fe] text-white"
                : "hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
            onClick={() => setMode("upload")}
          >
            <Upload size={12} />
            Upload
          </button>
        </div>

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
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUrlSubmit();
              }}
            />
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
              <Upload size={14} className="mr-1" />
              {selectedFileName || "Choose File"}
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
