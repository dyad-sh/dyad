import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface RenameChatDialogProps {
  chatId: number;
  currentTitle: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
}

export function RenameChatDialog({
  chatId,
  currentTitle,
  isOpen,
  onOpenChange,
  onRename,
}: RenameChatDialogProps) {
  const { t } = useTranslation("chat");
  const { t: tc } = useTranslation("common");
  const [newTitle, setNewTitle] = useState("");

  // Reset title when dialog opens
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setNewTitle(currentTitle || "");
    } else {
      setNewTitle("");
    }
    onOpenChange(open);
  };

  const handleSave = async () => {
    if (!newTitle.trim()) {
      return;
    }

    try {
      await ipc.chat.updateChat({
        chatId,
        title: newTitle.trim(),
      });
      showSuccess(t("chatRenamed"));

      // Call the parent's onRename callback to refresh the chat list
      onRename();

      // Close the dialog
      handleOpenChange(false);
    } catch (error) {
      showError(t("failedRenameChat", { error: (error as any).toString() }));
    }
  };

  const handleClose = () => {
    handleOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("renameChat")}</DialogTitle>
          <DialogDescription>{t("renameChatDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="chat-title" className="text-right">
              {t("chatTitle")}
            </Label>
            <Input
              id="chat-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="col-span-3"
              placeholder={t("enterChatTitle")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSave();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!newTitle.trim()}>
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
