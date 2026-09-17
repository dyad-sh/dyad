# GitLab as a publishing target

- Status: Accepted
- Date: 2026-09-16
- Related: upstream issue
  [dyad-sh/dyad#600](https://github.com/dyad-sh/dyad/issues/600) (Support
  Generic Git Remotes)

## Context

Dyad publishes an app by pushing it to a GitHub repository and, from there,
deploying it to Vercel or to a Coolify instance the user runs. GitHub is baked
into the settings schema, the `apps` columns, the git credential header, the
remote token scrub, the `github_ops` state machine, the Publish panel, and the
Coolify deploy path, which registers a deploy key through the GitHub API and
builds the clone URL as `git@github.com:...`.

Users who keep their code on GitLab, either gitlab.com or an instance they host
themselves, cannot publish at all today. The immediate goal is to let such an
app be pushed to GitLab and deployed to Coolify from there. GitLab.com and
self-hosted instances are treated as one target that differs only in its base
URL.

## Decisions

Each item below was an explicit choice. Alternatives that were considered and
rejected are noted where they shaped the design.

### Scope and rollout

1. **Upstream-ready, landed in the fork first.** The change is built so it can
   be proposed upstream against issue 600, but it merges into this fork before
   any upstream PR. Refactors of GitHub code paths are therefore kept minimal.
2. **Behind an Experiments toggle, off by default.** With the toggle off the
   Publish panel and the Integrations settings look exactly as they do today.
   The toggle gates new GitLab connections only: an app that is already linked
   to GitLab keeps showing its GitLab card when the toggle is turned off, so
   that it cannot be silently linked to GitHub as well.
3. **Publishing only.** In scope: connect an account, create a project,
   connect an existing project, list and switch branches, push, disconnect.
   The branch manager on the app details page works for GitLab apps because
   it is plain git apart from token resolution. Out of scope and recorded as
   follow-ups: importing an app from a GitLab URL, member management (the
   GitHub collaborator manager stays hidden for GitLab apps), and Vercel,
   which continues to require a GitHub repository.
4. **One pull request, several commits.** Each commit builds and passes lint.
   The fork may squash on merge; an upstream PR is cut later from the same
   branch.

### Authentication and connection

5. **Personal access token for every instance.** GitLab's device
   authorization grant needs an OAuth application registered on each instance,
   which Dyad cannot ship for self-hosted installs. A PAT is one code path for
   gitlab.com and self-hosted alike. The token must carry the `api` scope,
   which project creation, group listing and deploy keys all need; Dyad checks
   the scope through `/personal_access_tokens/self` before storing the token,
   shows the expiry date, and asks the user to reconnect on a 401.
6. **Exactly one GitLab connection at a time**, stored as
   `settings.gitlab = { instanceUrl, accessToken, user, tokenExpiresAt }`
   in the shape of the Coolify entry. The plain-http acknowledgement is a
   parameter of the save call, deliberately not stored, as Coolify's is.
   Each app records the host it was linked
   on. If the active connection points at a different host, push and deploy
   fail with a message that names both hosts; apps stay linked across
   connection changes.
7. **Instance URL defaults to `https://gitlab.com`.** Plain `http://` is
   allowed only behind the same explicit acknowledgement the Coolify connector
   uses. There is no option to skip certificate validation; users with a
   private CA install it at the system level.
8. **The credentials form is one shared component** rendered both in Settings
   under Integrations and inside the Publish panel, so a user does not have
   to leave the panel to connect.

### Architecture

9. **Parallel provider stack plus a thin shared layer.** GitLab gets its own
   API client, IPC contracts, settings entry and `apps` columns
   (`gitlab_host`, `gitlab_project_id`, `gitlab_project_path`,
   `gitlab_branch`). The existing GitHub columns are not migrated. Consumers
   that today read `githubOrg`/`githubRepo` directly (Publish panel, Coolify
   deploy, remote scrub, push handlers) go through one small module that
   answers, per app: which provider, which token, and which HTTPS and SSH
   clone URL. Deploy-key registration stays provider-specific in the Coolify
   commands, where the two APIs differ too much to share: GitHub takes one
   key per repository, GitLab lets one key serve several projects and reports
   whether it may push. A full generic provider abstraction was
   rejected as too large and risky for an upstream PR; a pure parallel stack
   was rejected because it spreads `if github else gitlab` through every
   consumer.
10. **The `github_ops` state machine is reused.** Push, pull, rebase,
    conflict handling and connect are git operations, not GitHub operations.
    The handler functions behind the machine resolve the provider per app.
    The only change to the machine is that every operation against a remote —
    link, push, rebase and rebase-continue — names its provider, so the
    success banner the machine composes says GitLab for a GitLab app. The
    field is required rather than optional: an earlier draft left it optional
    so GitHub payloads stayed byte-for-byte what they were, and that meant
    re-attaching it by hand at each composite edge. `rebase-continue` was
    missed, so a resumed rebase on a GitLab app announced a push to GitHub.
    Required, the compiler finds the next such gap. Renaming the machine and
    its channels to `git_ops` is a follow-up, not part of this change.
11. **Token injection is per host.** The git credential header
    (`http.<host>/.extraheader`) is built for the app's host with user
    `oauth2` and the PAT. The startup remote scrub removes embedded
    credentials for github.com and for the GitLab host an app is linked to,
    and for those only: a remote the user configured by hand on some other
    host is theirs, credentials and all.
12. **One provider per app.** An app is linked to GitHub or GitLab, never
    both. The Publish panel shows a single Repository card: unlinked, it
    offers the provider choice; linked, it shows that provider's sync UI.

### Projects and branches

13. **Group selection when creating a project.** Dyad lists the namespaces
    the user may create projects in. Self-hosted instances typically keep
    everything in groups, so a personal-namespace-only flow would be close to
    useless there. Projects are created private, matching GitHub.
14. **Existing projects are listed from Maintainer access upward**, so that
    connecting and pushing works on the first try; GitLab protects the default
    branch and lets only Maintainers push to it by default.
15. **Branch protection is left alone.** GitLab forbids force pushes to
    protected branches even for owners. Dyad does not change protection rules
    when creating a project. A rejected force push is translated into a hint
    that the branch is protected and force push can be allowed in the project
    settings.

### Coolify

16. **Deploy key per project, read-only, through the GitLab API.** The same
    mechanism as GitHub: Dyad generates the keypair, registers the public half
    on the project, hands the private half to Coolify, and creates the
    application through Coolify's provider-neutral `private-deploy-key`
    endpoint. GitLab would allow one key on several projects; a key per
    project is kept for symmetry with GitHub. Passing an HTTPS clone URL with
    an embedded token to Coolify was rejected.
17. **The SSH clone URL comes from the API.** At deploy time Dyad reads
    `ssh_url_to_repo` from the project instead of composing
    `git@<host>:<path>.git`, because self-hosted instances frequently serve
    SSH on a non-standard port that only the API reports correctly. There is
    no manual override in this version.
18. **Disconnecting keeps the deploy key**, as with GitHub, and Coolify
    receives the source on every deploy, so a repository change is picked up
    on the next deploy.

### Testing and localization

19. **Two end-to-end specs against a fake GitLab server** mounted under
    `/gitlab` in the existing fake server: one covers connect, create a
    project in a group, push, switch branches, link an existing project and
    disconnect; the other creates a project and deploys it to Coolify,
    verifying the read-only deploy key and the SSH clone URL with its
    non-standard port. Deploying an app linked to a pre-existing project is
    not covered by either and is left as a follow-up. Because the
    instance URL is user-supplied, the tests point Dyad at the fake server
    directly; no test-build switch is needed. Unit tests cover the handlers,
    the remote scrub and deploy-key registration.
20. **All six locales are updated together**, as the i18n rule requires. Note
    this covers the keys that exist: Settings, the Publish card and the
    credentials form are keyed, while the link form inside `GitLabConnector`
    is still hardcoded English, matching `GitHubConnector`, which has never
    been translated. Keying it is a follow-up, not a gap in the locales.

## Consequences

- Existing users see no change until they enable the experiment.
- Code that assumed "a linked app has a GitHub repo" now has to ask the
  shared module which provider is linked. Vercel keeps that assumption on
  purpose and reports that a GitHub repository is required.
- The name `github_ops` is inaccurate once it also serves GitLab apps. The
  rename is deferred to keep the upstream diff reviewable.
- Users of self-hosted instances behind a VPN must ensure their Coolify
  server can reach the instance over SSH; Dyad cannot detect that ahead of
  the deploy and the failure surfaces in Coolify's build log.

## Follow-ups

- Import an app from a GitLab project URL.
- Member management for GitLab projects.
- Rename `github_ops` to `git_ops` once the provider split has settled.
- Key the link forms in `GitLabConnector` and `GitHubConnector` for i18n;
  the `integrations.gitlab` namespace already exists in all six locales.
- Filter or page the namespace and project pickers: both listings stop at
  1000 items, silently.
- OAuth device flow for gitlab.com if a registered application becomes
  available.
