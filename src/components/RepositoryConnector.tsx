import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Github, Gitlab } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const { settings } = useSettings();
  const { status: gitlabStatus } = useGitLabStatus();
  const linked = describeLinkedRemote(app);
  const gitlabEnabled = !!settings?.enableGitlabPublishing;
  const [choice, setChoice] = useState<"github" | "gitlab" | null>(null);

  if (linked?.provider === "gitlab") {
    return (
      <GitLabConnector
        appId={appId}
        folderName={folderName}
        expanded={expanded}
      />
    );
  }
  if (linked?.provider === "github" || !gitlabEnabled) {
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
      <div className="flex rounded-md border border-gray-200 dark:border-gray-700">
        <Button
          type="button"
          variant={provider === "github" ? "default" : "ghost"}
          className={`flex-1 rounded-none rounded-l-md border-0 ${
            provider === "github"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
          onClick={() => setChoice("github")}
          data-testid="repository-provider-github"
        >
          <Github className="h-4 w-4" />
          GitHub
        </Button>
        <Button
          type="button"
          variant={provider === "gitlab" ? "default" : "ghost"}
          className={`flex-1 rounded-none rounded-r-md border-0 border-l border-gray-200 dark:border-gray-700 ${
            provider === "gitlab"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
          onClick={() => setChoice("gitlab")}
          data-testid="repository-provider-gitlab"
        >
          <Gitlab className="h-4 w-4" />
          GitLab
        </Button>
      </div>
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
