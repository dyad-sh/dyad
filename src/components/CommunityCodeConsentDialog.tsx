import { useTranslation } from "react-i18next";
import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface CommunityCodeConsentDialogProps {
  isOpen: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

export const CommunityCodeConsentDialog: React.FC<
  CommunityCodeConsentDialogProps
> = ({ isOpen, onAccept, onCancel }) => {
  const { t } = useTranslation(["home", "common"]);
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("home:communityCodeNotice")}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>{t("home:communityCodeWarning")}</p>
            <p>{t("home:communityCodeRisk")}</p>
            <p>{t("home:communityCodeReview")}</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {t("common:cancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={onAccept}>
            {t("common:accept")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
