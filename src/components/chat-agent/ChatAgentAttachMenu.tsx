import { useRef, useState } from "react";
import { ImageIcon, Paperclip, Plus } from "lucide-react";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { chatAgentAttachmentsAtom } from "@/atoms/chatAgentAtoms";
import type { FileAttachment } from "@/ipc/types";
import { cn } from "@/lib/utils";

const FILE_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.webp,.txt,.md,.js,.ts,.tsx,.jsx,.html,.css,.json,.csv,.pdf";

const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.svg";

type ChatAgentAttachMenuProps = {
  disabled?: boolean;
};

export function ChatAgentAttachMenu({ disabled }: ChatAgentAttachMenuProps) {
  const { t } = useTranslation("chat");
  const [, setAttachments] = useAtom(chatAgentAttachmentsAtom);
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (fileList: FileList | null, kind: "file" | "image") => {
    if (!fileList?.length) return;
    const next: FileAttachment[] = Array.from(fileList).map((file) => ({
      file,
      type: "chat-context",
    }));
    setAttachments((prev) => [...prev, ...next]);
    setOpen(false);
    if (kind === "file" && fileInputRef.current)
      fileInputRef.current.value = "";
    if (kind === "image" && imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          disabled={disabled}
          className={cn(
            "chat-agent-composer-icon-btn",
            open && "chat-agent-composer-icon-btn--active",
          )}
          aria-label={t("chatAgent.attachMenu")}
          data-testid="chat-agent-attach-menu"
        >
          <Plus
            className={cn(
              "size-5 transition-transform duration-200",
              open && "rotate-45",
            )}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="min-w-[12rem]">
          <DropdownMenuItem
            closeOnClick={false}
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-4" />
            {t("chatAgent.attachFiles")}
          </DropdownMenuItem>
          <DropdownMenuItem
            closeOnClick={false}
            className="gap-2"
            onClick={() => imageInputRef.current?.click()}
          >
            <ImageIcon className="size-4" />
            {t("chatAgent.attachImage")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept={FILE_ACCEPT}
        data-testid="chat-agent-file-input"
        onChange={(e) => addFiles(e.target.files, "file")}
      />
      <input
        ref={imageInputRef}
        type="file"
        className="hidden"
        multiple
        accept={IMAGE_ACCEPT}
        data-testid="chat-agent-image-input"
        onChange={(e) => addFiles(e.target.files, "image")}
      />
    </>
  );
}
