import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Github, Gitlab } from "lucide-react";
import { SegmentedChoice } from "@/components/SegmentedChoice";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useSettings } from "@/hooks/useSettings";
import { useGitLabStatus } from "@/hooks/useGitLabStatus";
import { describeLinkedRemote } from "@/shared/linked_remote";
import { GitHubConnector } from "@/components/GitHubConnector";
import { GitLabConnector } from "@/components/GitLabConnector";

/**
 * The connector for whichever provider an app's repository lives on.
 *
 * An app links to one provider at a time. A linked app gets that provider's
 * connector, whatever the experiment toggle says, so turning GitLab off
 * again cannot present a GitLab app as unlinked and invite a second link to
 * GitHub. An unlinked app gets a choice only while the toggle is on; with it
 * off this is exactly the GitHub connector it has always been.
 */
export function RepositoryConnector({
  appId,
  folderName,
  expanded,
}: {
  appId: number | null;
  folderName: string;
  expanded?: boolean;
}) {
  const { t } = useTranslation("home");
  const { app } = useLoadApp(appId);
  const { settings, loading: settingsLoading } = useSettings();
  const { status: gitlabStatus, isLoading: gitlabStatusLoading } =
    useGitLabStatus();
  const linked = describeLinkedRemote(app);
  const gitlabEnabled = !!settings?.enableGitlabPublishing;
  const [choice, setChoice] = useState<"github" | "gitlab" | null>(null);

  // This subtree is not remounted when the selected app changes, so a choice
  // made for one app would decide the provider for the next unlinked one.
  const [choiceAppId, setChoiceAppId] = useState(appId);
  if (choiceAppId !== appId) {
    setChoiceAppId(appId);
    setChoice(null);
  }

  if (linked?.provider === "gitlab") {
    return (
      <GitLabConnector
        appId={appId}
        folderName={folderName}
        expanded={expanded}
      />
    );
  }
  if (linked?.provider === "github") {
    return (
      <GitHubConnector
        appId={appId}
        folderName={folderName}
        expanded={expanded}
      />
    );
  }

  // An unlinked app's provider depends on two queries. Until both answer,
  // `enableGitlabPublishing` reads false and `gitlabStatus` reads
  // disconnected, which would show the GitHub connector to someone who has
  // the experiment on — and let them start linking to the wrong provider.
  if (settingsLoading || gitlabStatusLoading) {
    return (
      <p
        className="text-sm text-gray-600 dark:text-gray-400"
        data-testid="repository-connector-loading"
      >
        {t("preview.publish_panel.loadingProviders")}
      </p>
    );
  }

  if (!gitlabEnabled) {
    return (
      <GitHubConnector
        appId={appId}
        folderName={folderName}
        expanded={expanded}
      />
    );
  }

  // Nothing chosen yet: default to the provider that is already connected,
  // and to GitHub when both or neither are.
  const provider =
    choice ??
    (!settings?.githubAccessToken && gitlabStatus?.connected
      ? "gitlab"
      : "github");

  return (
    <div className="space-y-3" data-testid="repository-provider-choice">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {t("preview.publish_panel.chooseProvider")}
      </p>
      <SegmentedChoice
        ariaLabel={t("preview.publish_panel.chooseProvider")}
        value={provider}
        onChange={setChoice}
        options={[
          {
            value: "github",
            testId: "repository-provider-github",
            label: (
              <>
                <Github className="h-4 w-4" />
                GitHub
              </>
            ),
          },
          {
            value: "gitlab",
            testId: "repository-provider-gitlab",
            label: (
              <>
                <Gitlab className="h-4 w-4" />
                GitLab
              </>
            ),
          },
        ]}
      />
      {provider === "github" ? (
        <GitHubConnector
          appId={appId}
          folderName={folderName}
          expanded={expanded}
        />
      ) : (
        <GitLabConnector
          appId={appId}
          folderName={folderName}
          expanded={expanded}
        />
      )}
    </div>
  );
}
