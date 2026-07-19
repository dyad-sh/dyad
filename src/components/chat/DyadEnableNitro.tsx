import React from "react";
import { Server } from "lucide-react";
import {
  DyadCard,
  DyadCardHeader,
  DyadBadge,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import { CustomTagState } from "./stateTypes";
import { useTranslation } from "react-i18next";

interface DyadEnableNitroProps {
  state?: CustomTagState;
}

export const DyadEnableNitro: React.FC<DyadEnableNitroProps> = ({ state }) => {
  const { t } = useTranslation("chat");
  const isPending = state === "pending";
  const isAborted = state === "aborted";
  const headline = isPending
    ? t("addingNitroServerLayer")
    : isAborted
      ? t("nitroSetupAborted")
      : t("addedNitroServerLayer");
  return (
    <DyadCard accentColor="emerald" state={state}>
      <DyadCardHeader icon={<Server size={15} />} accentColor="emerald">
        <DyadBadge color="emerald">{t("serverLayer")}</DyadBadge>
        <span className="text-sm font-medium text-foreground">{headline}</span>
        {state && (
          <DyadStateIndicator state={state} abortedLabel={t("didNotFinish")} />
        )}
      </DyadCardHeader>
      {!isPending && !isAborted && (
        <div className="px-3 pb-3">
          <p className="text-xs text-muted-foreground leading-snug">
            {t("apiRoutesCanLiveUnder")}{" "}
            <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-muted">
              server/routes/api/
            </code>
          </p>
        </div>
      )}
    </DyadCard>
  );
};
