import React, { useCallback, useRef, useState } from "react";
import type { FileAttachment } from "@/ipc/types";
import { useAtom } from "jotai";
import { attachmentsAtom } from "@/atoms/chatAtoms";
import { showError } from "@/lib/toast";
import { validateChatAttachmentFiles } from "@/shared/chatAttachmentLimits";

export function useAttachments() {
  const [attachments, setAttachments] = useAtom(attachmentsAtom);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  const handleAttachmentClick = () => {
    fileInputRef.current?.click();
  };

  const validateFiles = useCallback(
    (
      files: readonly File[],
      existingAttachments: readonly FileAttachment[],
    ): boolean => {
      const validation = validateChatAttachmentFiles([
        ...existingAttachments.map(({ file }) => file),
        ...files,
      ]);
      if (!validation.ok) {
        showError(validation.message);
        return false;
      }
      return true;
    },
    [],
  );

  const addAttachments = useCallback(
    (
      files: File[],
      type: "chat-context" | "upload-to-codebase" = "chat-context",
    ): boolean => {
      const fileAttachments: FileAttachment[] = files.map((file) => ({
        file,
        type,
      }));
      let didAdd = false;
      setAttachments((current) => {
        if (!validateFiles(files, current)) {
          return current;
        }
        didAdd = true;
        return [...current, ...fileAttachments];
      });
      return didAdd;
    },
    [setAttachments, validateFiles],
  );

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "chat-context" | "upload-to-codebase" = "chat-context",
  ) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      addAttachments(files, type);
      // Clear the input value so the same file can be selected again
      e.target.value = "";
    }
  };

  const handleFileSelect = (
    fileList: FileList,
    type: "chat-context" | "upload-to-codebase",
  ) => {
    const files = Array.from(fileList);
    addAttachments(files, type);
  };

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!pendingFiles) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = () => {
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);

    if (pendingFiles) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      if (validateFiles(files, attachments)) {
        setPendingFiles(files);
      }
    }
  };

  const confirmPendingFiles = useCallback(
    (type: "chat-context" | "upload-to-codebase") => {
      if (pendingFiles && addAttachments(pendingFiles, type)) {
        setPendingFiles(null);
      }
    },
    [pendingFiles, addAttachments],
  );

  const cancelPendingFiles = useCallback(() => {
    setPendingFiles(null);
  }, []);

  const clearAttachments = () => {
    setAttachments([]);
    setPendingFiles(null);
  };

  const replaceAttachments = (newAttachments: FileAttachment[]) => {
    const validation = validateChatAttachmentFiles(
      newAttachments.map(({ file }) => file),
    );
    if (!validation.ok) {
      showError(validation.message);
      setAttachments([]);
      setPendingFiles(null);
      return false;
    }
    setAttachments(newAttachments);
    setPendingFiles(null);
    return true;
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    if (pendingFiles) return;

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const items = Array.from(clipboardData.items);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));

    if (imageItems.length > 0) {
      e.preventDefault(); // Prevent default paste behavior for images

      const imageFiles: File[] = [];
      // Generate base timestamp once to avoid collisions
      const baseTimestamp = new Date().toISOString().replace(/[:.]/g, "-");

      for (let i = 0; i < imageItems.length; i++) {
        const item = imageItems[i];
        const file = item.getAsFile();
        if (file) {
          // Create a more descriptive filename with timestamp and counter
          const extension = file.type.split("/")[1] || "png";
          const filename =
            imageItems.length === 1
              ? `pasted-image-${baseTimestamp}.${extension}`
              : `pasted-image-${baseTimestamp}-${i + 1}.${extension}`;

          const newFile = new File([file], filename, {
            type: file.type,
          });
          imageFiles.push(newFile);
        }
      }

      if (imageFiles.length > 0 && validateFiles(imageFiles, attachments)) {
        setPendingFiles(imageFiles);
      }
    }
  };

  return {
    attachments,
    fileInputRef,
    isDraggingOver,
    pendingFiles,
    handleAttachmentClick,
    handleFileChange,
    handleFileSelect,
    removeAttachment,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    clearAttachments,
    handlePaste,
    addAttachments,
    replaceAttachments,
    confirmPendingFiles,
    cancelPendingFiles,
  };
}
