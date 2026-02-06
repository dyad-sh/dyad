import { useTranslation } from "react-i18next";
import React from "react";
import { Trash2, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

interface DeleteConfirmationDialogProps {
  itemName: string;
  itemType?: string;
  onDelete: () => void | Promise<void>;
  trigger?: React.ReactNode;
  isDeleting?: boolean;
}

export function DeleteConfirmationDialog({
  itemName,
  itemType = "item",
  onDelete,
  trigger,
  isDeleting = false,
}: DeleteConfirmationDialogProps) {
  const { t } = useTranslation(["home", "common"]);
  return (
    <AlertDialog>
      {trigger ? (
        <AlertDialogTrigger>{trigger}</AlertDialogTrigger>
      ) : (
        <AlertDialogTrigger
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          data-testid="delete-prompt-button"
          disabled={isDeleting}
          title={`${t("common:delete")} ${itemType.toLowerCase()}`}
        >
          <Trash2 className="h-4 w-4" />
        </AlertDialogTrigger>
      )}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("home:deleteItemTitle", { itemType })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("home:deleteItemConfirmation", { itemName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>
            {t("common:cancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onDelete} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("common:deleting")}
              </>
            ) : (
              t("common:delete")
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
