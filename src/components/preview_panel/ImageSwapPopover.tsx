import { useState, useRef, useEffect } from "react";
import { ImageIcon, Upload, Link, Check } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StylePopover } from "./StylePopover";
import { VALID_IMAGE_MIME_TYPES } from "@/ipc/types/visual-editing";
import { useTranslation } from "react-i18next";

export interface ImageUploadData {
  fileName: string;
  base64Data: string;
  mimeType: string;
}

interface ImageSwapPopoverProps {
  currentSrc: string;
  isDynamicImage?: boolean;
  onSwap: (newSrc: string, uploadData?: ImageUploadData) => void;
}

export function ImageSwapPopover({
  currentSrc,
  isDynamicImage,
  onSwap,
}: ImageSwapPopoverProps) {
  const { t } = useTranslation("home");
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [urlValue, setUrlValue] = useState(currentSrc);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [appliedSrc, setAppliedSrc] = useState(currentSrc);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state when a different component is selected
  useEffect(() => {
    setUrlValue(currentSrc);
    setAppliedSrc(currentSrc);
    setSelectedFileName(null);
    setFileError(null);
    setUrlError(null);
  }, [currentSrc]);

  const handleUrlSubmit = () => {
    const trimmed = urlValue.trim();
    if (!trimmed) {
      setUrlError(t("preview.imageSwap.pleaseEnterUrl"));
      return;
    }
    // Accept absolute URLs (http/https/protocol-relative) and root-relative paths
    if (
      !/^https?:\/\//i.test(trimmed) &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("/")
    ) {
      setUrlError(t("preview.imageSwap.invalidUrl"));
      return;
    }
    setUrlError(null);
    setAppliedSrc(trimmed);
    onSwap(trimmed);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!(VALID_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setFileError(t("preview.imageSwap.unsupportedType"));
      return;
    }
    if (file.size > 7.5 * 1024 * 1024) {
      setFileError(t("preview.imageSwap.tooLarge"));
      return;
    }
    setFileError(null);

    setSelectedFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const base64DataUrl = reader.result as string;

      // The handler will generate the final unique filename.
      // We just need a placeholder path for the pending change.
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const newSrc = `/images/${sanitizedName}`;

      setAppliedSrc(newSrc);
      onSwap(newSrc, {
        fileName: file.name,
        base64Data: base64DataUrl,
        mimeType: file.type,
      });
    };
    reader.onerror = () => {
      setFileError(t("preview.imageSwap.readFailed"));
      setSelectedFileName(null);
    };
    reader.readAsDataURL(file);

    // Clear input so same file can be selected again
    e.target.value = "";
  };

  return (
    <StylePopover
      icon={<ImageIcon size={16} />}
      title={t("preview.imageSwap.sourceTitle")}
      tooltip={t("preview.imageSwap.tooltip")}
    >
      <div className="space-y-3">
        {isDynamicImage && (
          <p className="text-xs text-yellow-600 dark:text-yellow-400">
            {t("preview.imageSwap.dynamicSourceWarning")}
          </p>
        )}

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
              {t("preview.imageSwap.upload")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "url" ? (
          <div className="space-y-2">
            <Label htmlFor="image-url" className="text-xs">
              {t("preview.imageSwap.imageUrl")}
            </Label>
            <Input
              id="image-url"
              type="text"
              placeholder="https://example.com/image.png"
              className="h-8 text-xs"
              value={urlValue}
              aria-invalid={!!urlError}
              aria-describedby={urlError ? "image-url-error" : undefined}
              onChange={(e) => {
                setUrlValue(e.target.value);
                setUrlError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUrlSubmit();
              }}
            />
            {urlError && (
              <p
                id="image-url-error"
                role="alert"
                className="text-xs text-red-500"
              >
                {urlError}
              </p>
            )}
            <Button size="sm" onClick={handleUrlSubmit} className="w-full">
              <Check size={14} className="mr-1" />
              {t("preview.imageSwap.apply")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs">
              {t("preview.imageSwap.uploadImage")}
            </Label>
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
                {selectedFileName || t("preview.imageSwap.chooseFile")}
              </span>
            </Button>
            {fileError && (
              <p role="alert" className="text-xs text-red-500">
                {fileError}
              </p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("preview.imageSwap.supportedFormats")}
            </p>
          </div>
        )}

        {/* Current source display */}
        <div className="pt-2 border-t border-border">
          <Label className="text-xs text-gray-500 dark:text-gray-400">
            {t("preview.imageSwap.currentSource")}
          </Label>
          <p className="text-xs font-mono truncate mt-1" title={appliedSrc}>
            {appliedSrc || t("preview.imageSwap.none")}
          </p>
        </div>
      </div>
    </StylePopover>
  );
}
