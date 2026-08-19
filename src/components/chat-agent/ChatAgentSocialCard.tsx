import { useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Hash,
  ImagePlus,
  Loader2,
  RefreshCcw,
  Rows3,
  Send,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";

import { XPostPreview } from "@/components/social/XPostPreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useGeneratePostCopy, useSocialPosts } from "@/hooks/useSocialMedia";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";
import { NANO_BANANA_2_MODEL } from "@/ipc/types/image_generation";
import type { SocialPost } from "@/ipc/types/social_media";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { getAssignedModelForRole } from "@/lib/model_roles";

type SocialPresentation = Extract<
  ChatAgentToolPresentation,
  { kind: "x-profile" | "x-post-composer" }
>;
type XProfilePresentation = Extract<SocialPresentation, { kind: "x-profile" }>;
type XComposerPresentation = Extract<
  SocialPresentation,
  { kind: "x-post-composer" }
>;

function compact(value?: number) {
  if (value == null) return "—";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function localDateTimeInputValue(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function ProfileAvatar({
  presentation,
}: {
  presentation: XProfilePresentation;
}) {
  const name = presentation.displayName || presentation.username;
  return presentation.profileImageUrl ? (
    <img
      src={presentation.profileImageUrl}
      alt={`${name} profile`}
      className="size-16 rounded-full border-2 border-background object-cover shadow-xl"
    />
  ) : (
    <span className="grid size-16 place-items-center rounded-full bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600 text-xl font-bold text-white shadow-xl">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function ChatAgentXProfileCard({
  presentation,
}: {
  presentation: XProfilePresentation;
}) {
  const synced = presentation.profileSyncedAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(presentation.profileSyncedAt)
    : null;

  return (
    <section
      className="chat-card-fly-in mt-3 max-w-2xl overflow-hidden rounded-3xl border border-border/70 bg-card text-card-foreground shadow-xl"
      data-testid="chat-x-profile-card"
    >
      <div className="h-20 bg-[radial-gradient(circle_at_25%_0%,rgba(29,155,240,0.55),transparent_52%),linear-gradient(120deg,#07111f,#111827_55%,#050505)]" />
      <div className="px-5 pb-5">
        <div className="-mt-8 flex items-end justify-between gap-4">
          <ProfileAvatar presentation={presentation} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() =>
              void ipc.system.openExternalUrl(presentation.profileUrl)
            }
          >
            View on X <ExternalLink className="size-3.5" />
          </Button>
        </div>
        <div className="mt-3">
          <div className="flex items-center gap-1.5">
            <h3 className="text-lg font-bold leading-tight">
              {presentation.displayName || presentation.username}
            </h3>
            {presentation.verified && (
              <BadgeCheck
                className="size-5 fill-[#1d9bf0] text-white dark:text-black"
                aria-label="Verified"
              />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            @{presentation.username.replace(/^@/, "")}
            {presentation.verifiedType ? ` · ${presentation.verifiedType}` : ""}
          </p>
        </div>
        {presentation.bio && (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
            {presentation.bio}
          </p>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ["Followers", presentation.followersCount],
            ["Following", presentation.followingCount],
            ["Posts", presentation.postCount],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-border/60 bg-muted/35 px-3 py-2.5"
            >
              <p className="text-base font-bold tabular-nums">
                {compact(value as number | undefined)}
              </p>
              <p className="text-[11px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" /> Connected
          </span>
          {synced && <span>Last synced {synced}</span>}
        </div>
      </div>
    </section>
  );
}

function XComposerCard({
  presentation,
}: {
  presentation: XComposerPresentation;
}) {
  const { createPost, publishPost } = useSocialPosts();
  const { generateCopy } = useGeneratePostCopy();
  const { settings } = useSettings();
  const [content, setContent] = useState(presentation.content);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [outcome, setOutcome] = useState<"published" | "scheduled" | null>(
    null,
  );
  const [publishedPost, setPublishedPost] = useState<SocialPost | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const overLimit = content.length > 280;
  const assignedImageModel = settings
    ? getAssignedModelForRole(settings, "image")
    : undefined;
  const imageModel =
    assignedImageModel?.name ??
    settings?.imageAgentModel ??
    NANO_BANANA_2_MODEL;
  const scheduleMs = useMemo(() => {
    const parsed = new Date(scheduledFor).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }, [scheduledFor]);

  const reportError = (error: unknown) =>
    showError(error instanceof Error ? error.message : String(error));

  const refine = async (instruction: string) => {
    if (!content.trim() || busy) return;
    setBusy(instruction);
    try {
      const result = await generateCopy({
        platform: "x",
        prompt: `${instruction}\n\nCurrent post:\n${content.trim()}`,
        includeImage: false,
      });
      setContent(result.content);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  const generateImage = async () => {
    if (busy) return;
    setBusy("image");
    try {
      const result = await ipc.imageGeneration.generateAgentImage({
        prompt:
          presentation.imagePrompt?.trim() ||
          `Create a premium editorial social image for this X post. No text or logos. ${content}`,
        provider: assignedImageModel?.provider,
        model: imageModel,
      });
      setImage(result.images[0] ?? null);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  const attach = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      showError("Choose an image up to 10 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string" && setImage(reader.result);
    reader.onerror = () => showError("The image could not be read.");
    reader.readAsDataURL(file);
  };

  const postNow = async () => {
    if (!content.trim() || overLimit || busy) return;
    setBusy("post");
    try {
      const post = await createPost({
        platform: "x",
        content: content.trim(),
        image,
        prompt: presentation.prompt ?? null,
      });
      const published = await publishPost(post.id);
      setOutcome("published");
      setPublishedPost(published);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  const schedule = async () => {
    if (!content.trim() || overLimit || busy) return;
    if (scheduleMs == null || scheduleMs <= Date.now()) {
      showError("Choose a future date and time.");
      return;
    }
    setBusy("schedule");
    try {
      await createPost({
        platform: "x",
        content: content.trim(),
        image,
        prompt: presentation.prompt ?? null,
        scheduledFor: scheduleMs,
      });
      setOutcome("scheduled");
      showSuccess("Scheduled and added to the content planner");
      setScheduleOpen(false);
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="chat-card-fly-in mt-3 max-w-2xl overflow-hidden rounded-3xl border border-border/70 bg-card p-4 text-card-foreground shadow-xl sm:p-5"
      data-testid="chat-x-post-composer"
    >
      <input
        ref={fileRef}
        className="hidden"
        type="file"
        accept="image/*"
        onChange={(event) => {
          attach(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-[#1d9bf0]" /> X post studio
          </p>
          <p className="text-xs text-muted-foreground">
            Posting as @{presentation.username.replace(/^@/, "")}
          </p>
        </div>
        <span
          className={cn(
            "text-xs tabular-nums",
            overLimit
              ? "font-semibold text-destructive"
              : "text-muted-foreground",
          )}
        >
          {content.length}/280
        </span>
      </div>

      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={4}
        className="resize-none text-sm leading-relaxed"
        aria-label="X post text"
        disabled={Boolean(outcome)}
      />
      <p className="mb-3 mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Click above to edit the proposed post before publishing.</span>
        {overLimit && <span className="text-destructive">Shorten to post</span>}
      </p>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {[
          [
            "Polish",
            Wand2,
            "Polish for clarity, rhythm, and impact while preserving the meaning.",
          ],
          [
            "Shorten",
            RefreshCcw,
            "Shorten substantially and keep only the strongest idea.",
          ],
          [
            "Expand",
            Rows3,
            "Add one useful detail or sharper insight while staying within 280 characters.",
          ],
          [
            "Tone",
            Sparkles,
            "Use a confident, warm, conversational and human tone.",
          ],
          [
            "Hashtags",
            Hash,
            "Add at most two highly relevant hashtags only if useful.",
          ],
          [
            "Variation",
            RefreshCcw,
            "Write a fresh variation with a different hook and structure.",
          ],
        ].map(([label, Icon, instruction]) => (
          <Button
            key={String(label)}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full px-2.5 text-[11px]"
            disabled={Boolean(busy) || Boolean(outcome)}
            onClick={() => void refine(String(instruction))}
          >
            <Icon className="size-3" /> {String(label)}
          </Button>
        ))}
      </div>

      <XPostPreview
        displayName={presentation.displayName}
        username={presentation.username}
        profileImageUrl={presentation.profileImageUrl}
        verified={presentation.verified}
        content={content}
        image={image}
        compact
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={Boolean(busy) || Boolean(outcome)}
        >
          <Upload className="size-3.5" /> Attach image
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void generateImage()}
          disabled={Boolean(busy) || Boolean(outcome)}
        >
          {busy === "image" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5" />
          )}
          {image ? "Regenerate image" : "Generate image"}
        </Button>
        {image && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setImage(null)}
            disabled={Boolean(busy) || Boolean(outcome)}
          >
            Remove image
          </Button>
        )}
      </div>

      {scheduleOpen && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl border border-border/60 bg-muted/35 p-3">
          <label className="min-w-56 flex-1 text-xs text-muted-foreground">
            Publish date and time
            <Input
              type="datetime-local"
              value={scheduledFor}
              min={localDateTimeInputValue(new Date(Date.now() + 60_000))}
              onChange={(event) => setScheduledFor(event.target.value)}
              className="mt-1"
            />
          </label>
          <Button
            type="button"
            size="sm"
            onClick={() => void schedule()}
            disabled={Boolean(busy) || overLimit || !content.trim()}
          >
            {busy === "schedule" && (
              <Loader2 className="size-3.5 animate-spin" />
            )}
            Confirm schedule
          </Button>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/60 pt-4">
        {outcome && (
          <span className="mr-auto inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-current" />
            {outcome === "published"
              ? "Published · saved in Today"
              : "Scheduled · saved in planner"}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => setScheduleOpen((open) => !open)}
          disabled={Boolean(busy) || Boolean(outcome)}
        >
          <CalendarClock className="size-4" /> Schedule
        </Button>
        <Button
          type="button"
          onClick={() => void postNow()}
          disabled={
            Boolean(busy) || Boolean(outcome) || overLimit || !content.trim()
          }
        >
          {busy === "post" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Post now
        </Button>
      </div>

      <Dialog
        open={publishedPost !== null}
        onOpenChange={(open) => {
          if (!open) setPublishedPost(null);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-border/60 px-5 py-4 pr-12">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-500">
                <CheckCircle2 className="size-5" />
              </span>
              <div>
                <DialogTitle>Posted successfully</DialogTitle>
                <DialogDescription className="mt-1">
                  Your post is live on X and saved under Today in the planner.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {publishedPost && (
            <div className="space-y-4 px-5 pb-5">
              <XPostPreview
                displayName={presentation.displayName}
                username={presentation.username}
                profileImageUrl={presentation.profileImageUrl}
                verified={presentation.verified}
                content={publishedPost.content}
                image={publishedPost.image}
                metrics={publishedPost.metrics}
                timestamp="now"
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPublishedPost(null)}
                >
                  Done
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const url =
                      publishedPost.externalUrl ??
                      (publishedPost.externalId
                        ? `https://x.com/${encodeURIComponent(presentation.username)}/status/${encodeURIComponent(publishedPost.externalId)}`
                        : `https://x.com/${encodeURIComponent(presentation.username)}`);
                    void ipc.system.openExternalUrl(url);
                  }}
                >
                  View post on X <ExternalLink className="size-4" />
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function ChatAgentSocialCard({
  presentation,
}: {
  presentation: SocialPresentation;
}) {
  return presentation.kind === "x-profile" ? (
    <ChatAgentXProfileCard presentation={presentation} />
  ) : (
    <XComposerCard presentation={presentation} />
  );
}
