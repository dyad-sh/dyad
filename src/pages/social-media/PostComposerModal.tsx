import { useEffect, useMemo, useState } from "react";
import { addHours, format, isToday, startOfHour } from "date-fns";
import {
  ArrowLeft,
  CalendarClock,
  Globe2,
  ImageOff,
  Loader2,
  PlugZap,
  RefreshCcw,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";

import { SocialConnectDialog } from "@/components/social/SocialConnectDialog";
import {
  SOCIAL_PLATFORM_META,
  SocialPlatformIcon,
} from "@/components/social/social-platform-meta";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useGeneratePostCopy,
  useSocialConnections,
  useSocialPosts,
} from "@/hooks/useSocialMedia";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import {
  NANO_BANANA_2_LABEL,
  NANO_BANANA_2_MODEL,
} from "@/ipc/types/image_generation";
import type { SocialPlatform } from "@/ipc/types/social_media";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

const X_CHAR_LIMIT = 280;

type GenerationPhase = "idle" | "copy" | "image";

/** Platform-styled preview of how the post will look once published. */
function PostPreview({
  platform,
  accountName,
  content,
  image,
  onContentChange,
}: {
  platform: SocialPlatform;
  accountName: string;
  content: string;
  image: string | null;
  onContentChange: (value: string) => void;
}) {
  const overLimit = platform === "x" && content.length > X_CHAR_LIMIT;
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        platform === "facebook"
          ? "border-blue-400/25 bg-[rgba(12,20,38,0.85)]"
          : "border-white/15 bg-black/60",
      )}
      data-testid="post-preview"
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid size-9 place-items-center rounded-full border",
            SOCIAL_PLATFORM_META[platform].iconWrapClass,
          )}
        >
          <SocialPlatformIcon platform={platform} className="size-4" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">{accountName}</p>
          <p className="flex items-center gap-1 text-[11px] text-white/40">
            Just now · <Globe2 className="size-3" />
          </p>
        </div>
      </div>

      <Textarea
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        rows={Math.min(8, Math.max(3, content.split("\n").length + 1))}
        className="mt-3 w-full resize-y border-white/10 bg-transparent text-sm leading-relaxed text-white/90"
        data-testid="post-preview-content"
      />
      <div className="mt-1 flex justify-end">
        <span
          className={cn(
            "text-[11px] tabular-nums",
            overLimit ? "font-semibold text-rose-400" : "text-white/35",
          )}
        >
          {platform === "x"
            ? `${content.length}/${X_CHAR_LIMIT}`
            : `${content.length} characters`}
        </span>
      </div>

      {image && (
        <img
          src={image}
          alt="Generated post visual"
          className="mt-2 max-h-72 w-full rounded-xl border border-white/10 object-cover"
        />
      )}
    </div>
  );
}

/**
 * Day-click composer: pick a platform, describe the post, let AI write the
 * copy and render the image (Nano Banana by default), preview it, then
 * schedule it or post right away. Every outcome lands in the planner.
 */
export function PostComposerModal({
  open,
  onOpenChange,
  initialDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate: Date;
}) {
  const { connections } = useSocialConnections();
  const { createPost, publishPost } = useSocialPosts();
  const { generateCopy } = useGeneratePostCopy();
  const { settings } = useSettings();

  const [step, setStep] = useState<"compose" | "preview">("compose");
  const [platform, setPlatform] = useState<SocialPlatform>("facebook");
  const [prompt, setPrompt] = useState("");
  const [includeImage, setIncludeImage] = useState(true);
  const [phase, setPhase] = useState<GenerationPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [submitting, setSubmitting] = useState<"schedule" | "now" | null>(null);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);

  // Reset per opening, anchored to the clicked calendar day.
  useEffect(() => {
    if (!open) return;
    setStep("compose");
    setPrompt("");
    setIncludeImage(true);
    setPhase("idle");
    setError(null);
    setContent("");
    setImage(null);
    setImagePrompt("");
    setSubmitting(null);
    setScheduleDate(format(initialDate, "yyyy-MM-dd"));
    setScheduleTime(
      isToday(initialDate)
        ? format(startOfHour(addHours(new Date(), 1)), "HH:mm")
        : "09:00",
    );
  }, [open, initialDate]);

  const imageModel = settings?.imageAgentModel ?? NANO_BANANA_2_MODEL;
  const platformMeta = SOCIAL_PLATFORM_META[platform];
  const isConnected = connections?.[platform]?.connected ?? false;
  const accountName =
    platform === "facebook"
      ? (connections?.facebook.pageName ?? "Your Page")
      : connections?.x.username
        ? `@${connections.x.username}`
        : "@you";

  const isGenerating = phase !== "idle";
  const overLimit = platform === "x" && content.length > X_CHAR_LIMIT;

  const scheduledForMs = useMemo(() => {
    if (!scheduleDate || !scheduleTime) return null;
    const ts = new Date(`${scheduleDate}T${scheduleTime}`).getTime();
    return Number.isNaN(ts) ? null : ts;
  }, [scheduleDate, scheduleTime]);

  const generateImageFrom = async (fromPrompt: string) => {
    const result = await ipc.imageGeneration.generateAgentImage({
      prompt: fromPrompt,
      model: imageModel,
    });
    setImage(result.images[0] ?? null);
  };

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    setError(null);
    try {
      setPhase("copy");
      const copy = await generateCopy({
        platform,
        prompt: trimmed,
        includeImage,
      });
      setContent(copy.content);
      setImagePrompt(copy.imagePrompt);
      if (includeImage) {
        setPhase("image");
        await generateImageFrom(copy.imagePrompt);
      } else {
        setImage(null);
      }
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  };

  const handleRegenerateImage = async () => {
    if (isGenerating) return;
    setError(null);
    try {
      setPhase("image");
      await generateImageFrom(imagePrompt.trim() || prompt.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  };

  const handleSchedule = async () => {
    if (!content.trim() || submitting) return;
    if (scheduledForMs == null || scheduledForMs <= Date.now()) {
      setError("Pick a future date and time, or use Post now.");
      return;
    }
    setError(null);
    setSubmitting("schedule");
    try {
      await createPost({
        platform,
        content: content.trim(),
        image,
        prompt: prompt.trim() || null,
        scheduledFor: scheduledForMs,
      });
      showSuccess(
        `Scheduled for ${format(scheduledForMs, "MMM d 'at' HH:mm")} — added to the planner`,
      );
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(null);
    }
  };

  const handlePostNow = async () => {
    if (!content.trim() || submitting) return;
    setError(null);
    setSubmitting("now");
    try {
      const post = await createPost({
        platform,
        content: content.trim(),
        image,
        prompt: prompt.trim() || null,
      });
      try {
        await publishPost(post.id);
        showSuccess(
          `Published to ${platformMeta.label} — copy saved to the planner`,
        );
        onOpenChange(false);
      } catch (publishError) {
        // The draft stays in the planner as "failed" so nothing is lost.
        showError(
          publishError instanceof Error
            ? publishError.message
            : String(publishError),
        );
        onOpenChange(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !isGenerating && onOpenChange(o)}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-cyan-300" />
            {step === "compose" ? "Create post" : "Preview post"}
          </DialogTitle>
          <DialogDescription>
            {step === "compose"
              ? `Composing for ${format(initialDate, "EEEE, MMMM d")} — AI writes the copy and renders the image (${
                  imageModel === NANO_BANANA_2_MODEL
                    ? NANO_BANANA_2_LABEL
                    : imageModel
                }).`
              : "Fine-tune the copy, regenerate the image, then schedule it or post right away."}
          </DialogDescription>
        </DialogHeader>

        {step === "compose" ? (
          <div className="space-y-4">
            {/* Platform selection */}
            <div className="grid grid-cols-2 gap-2">
              {(["facebook", "x"] as const).map((p) => {
                const meta = SOCIAL_PLATFORM_META[p];
                const connected = connections?.[p]?.connected ?? false;
                const selected = platform === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border p-3 text-left transition",
                      selected
                        ? "border-cyan-400/50 bg-cyan-500/10 shadow-[0_0_18px_rgba(0,229,255,0.15)]"
                        : "border-white/10 bg-white/5 hover:border-white/25",
                    )}
                    data-testid={`composer-platform-${p}`}
                  >
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-xl border ${meta.iconWrapClass}`}
                    >
                      <SocialPlatformIcon platform={p} className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-white">
                        {meta.label}
                      </span>
                      <span
                        className={cn(
                          "block text-[11px]",
                          connected ? "text-emerald-300" : "text-white/40",
                        )}
                      >
                        {connected ? "Connected" : "Not connected"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {!isConnected && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <span>
                  {platformMeta.label} isn't connected — you can generate and
                  schedule, but publishing needs a connection.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setConnectDialogOpen(true)}
                >
                  <PlugZap className="size-3.5" />
                  Connect
                </Button>
              </div>
            )}

            {/* Prompt */}
            <div className="space-y-1.5">
              <label
                htmlFor="composer-prompt"
                className="text-sm font-medium text-white/80"
              >
                What is this post about?
              </label>
              <Textarea
                id="composer-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="e.g. Announce our new AI-powered analytics dashboard launching Friday — confident, exciting tone, aimed at startup founders"
                className="resize-none"
                data-testid="composer-prompt"
              />
            </div>

            {/* Image toggle */}
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-white/85">
                  Generate image
                </p>
                <p className="text-[11px] text-white/40">
                  {imageModel === NANO_BANANA_2_MODEL
                    ? NANO_BANANA_2_LABEL
                    : imageModel}{" "}
                  renders a visual to match the post
                </p>
              </div>
              <Switch
                checked={includeImage}
                onCheckedChange={setIncludeImage}
                data-testid="composer-include-image"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <Button
              className="w-full"
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating}
              data-testid="composer-generate"
            >
              {isGenerating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              {phase === "copy"
                ? "Writing copy…"
                : phase === "image"
                  ? "Rendering image…"
                  : "Generate with AI"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <PostPreview
              platform={platform}
              accountName={accountName}
              content={content}
              image={image}
              onContentChange={setContent}
            />

            {/* Image controls */}
            {includeImage && (
              <div className="flex items-center gap-2">
                <Input
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="Image prompt"
                  className="flex-1 text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerateImage}
                  disabled={isGenerating}
                >
                  {phase === "image" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="size-3.5" />
                  )}
                  Image
                </Button>
                {image && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setImage(null)}
                  >
                    <ImageOff className="size-3.5" />
                    Remove
                  </Button>
                )}
              </div>
            )}

            {/* Schedule controls */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-white/50">
                <CalendarClock className="size-3.5" />
                Schedule
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-40"
                  data-testid="composer-schedule-date"
                />
                <Input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-28"
                  data-testid="composer-schedule-time"
                />
                <span className="text-[11px] text-white/35">
                  Publishes automatically when due
                </span>
              </div>
            </div>

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setStep("compose")}
                disabled={isGenerating || submitting != null}
              >
                <ArrowLeft className="size-4" />
                Back
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleSchedule}
                  disabled={
                    !content.trim() ||
                    overLimit ||
                    isGenerating ||
                    submitting != null
                  }
                  data-testid="composer-schedule"
                >
                  {submitting === "schedule" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CalendarClock className="size-4" />
                  )}
                  Schedule
                </Button>
                <Button
                  onClick={handlePostNow}
                  disabled={
                    !content.trim() ||
                    overLimit ||
                    isGenerating ||
                    submitting != null
                  }
                  data-testid="composer-post-now"
                >
                  {submitting === "now" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Post now
                </Button>
              </div>
            </div>
            {overLimit && (
              <p className="text-right text-[11px] text-rose-400">
                X posts must be {X_CHAR_LIMIT} characters or fewer.
              </p>
            )}
          </div>
        )}

        <SocialConnectDialog
          platform={platform}
          open={connectDialogOpen}
          onOpenChange={setConnectDialogOpen}
        />
      </DialogContent>
    </Dialog>
  );
}
