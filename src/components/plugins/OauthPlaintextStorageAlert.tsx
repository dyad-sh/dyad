import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTranslation } from "react-i18next";

export function OauthPlaintextStorageAlert() {
  const { t } = useTranslation("home");

  return (
    <Alert variant="destructive">
      <AlertTitle>{t("plugins.oauthStorageTitle")}</AlertTitle>
      <AlertDescription>
        {t("plugins.oauthStorageDescription", {
          libsecret: "libsecret",
          gnomeKeyring: "gnome-keyring",
        })}
      </AlertDescription>
    </Alert>
  );
}
