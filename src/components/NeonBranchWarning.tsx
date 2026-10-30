import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function NeonBranchWarning({
  usage,
  onUseRecommended,
  disabled,
}: {
  usage: "deployment" | "development";
  onUseRecommended?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("home");
  return (
    <Alert variant="destructive" className="border-destructive/50">
      <AlertTriangle />
      <AlertTitle className="line-clamp-none">
        {t(`integrations.neon.branchSafety.${usage}Title`)}
      </AlertTitle>
      <AlertDescription>
        <p>{t(`integrations.neon.branchSafety.${usage}Warning`)}</p>
        {onUseRecommended && (
          <Button
            className="mt-2 h-auto max-w-full whitespace-normal text-left"
            disabled={disabled}
            onClick={onUseRecommended}
          >
            {t(`integrations.neon.branchSafety.${usage}Recommended`)}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
