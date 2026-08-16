import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  BarChart3,
  CalendarClock,
  CalendarX2,
  Copy,
  ExternalLink,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Repeat2,
  Save,
  Send,
  Trash2,
} from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { XPostPreview } from "@/components/social/XPostPreview";
import { useSocialConnections, useSocialPosts } from "@/hooks/useSocialMedia";
import type { SocialPost, SocialPostMetrics } from "@/ipc/types/social_media";
import { showError, showSuccess } from "@/lib/toast";
import { PostStatusBadge } from "./post-meta";

/**
 * Planner entry details: review the copy and image, reschedule drafts and
 * scheduled posts, publish immediately, delete, or jump to the live post.
 */
export function PostDetailsModal({
  post,
  open,
  onOpenChange,
}: {
  post: SocialPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    createPost,
    updatePost,
    deletePost,
    publishPost,
    refreshPostMetrics,
  } = useSocialPosts();
  const { connections } = useSocialConnections();
  const [busy, setBusy] = useState<
    | "publish"
    | "reschedule"
    | "delete"
    | "save"
    | "duplicate"
    | "metrics"
    | null
  >(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [content, setContent] = useState("");
  const [metrics, setMetrics] = useState<SocialPostMetrics | null>(null);
  const [metricsUpdatedAt, setMetricsUpdatedAt] = useState<number | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const autoRefreshKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !post) {
      autoRefreshKeyRef.current = null;
      return;
    }
    setBusy(null);
    setContent(post.content);
    setMetrics(post.metrics ?? null);
    setMetricsUpdatedAt(post.metricsUpdatedAt ?? null);
    setMetricsError(null);
    const base = post.scheduledFor ?? Date.now();
    setScheduleDate(format(base, "yyyy-MM-dd"));
    setScheduleTime(format(base, "HH:mm"));
  }, [open, post]);

  useEffect(() => {
    if (
      !open ||
      !post ||
      post.platform !== "x" ||
      post.status !== "posted" ||
      !post.externalId
    ) {
      return;
    }

    // React Strict Mode remounts effects in development. Keep one X lookup per
    // modal opening so opening details never double-charges or races the API.
    const refreshKey = `${post.id}:${post.externalId}`;
    if (autoRefreshKeyRef.current === refreshKey) return;
    autoRefreshKeyRef.current = refreshKey;

    setBusy("metrics");
    setMetricsError(null);
    void refreshPostMetrics(post.id)
      .then((updated) => {
        if (autoRefreshKeyRef.current !== refreshKey) return;
        setMetrics(updated.metrics ?? null);
        setMetricsUpdatedAt(updated.metricsUpdatedAt ?? null);
      })
      .catch((error: unknown) => {
        if (autoRefreshKeyRef.current !== refreshKey) return;
        setMetricsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (autoRefreshKeyRef.current === refreshKey) setBusy(null);
      });
  }, [open, post, refreshPostMetrics]);

  if (!post) return null;

  const meta = SOCIAL_PLATFORM_META[post.platform];
  const isEditable = post.status !== "posted" && post.status !== "posting";
  const overLimit = post.platform === "x" && content.length > 280;

  const handlePublishNow = async () => {
    if (overLimit) {
      showError("X posts must be 280 characters or fewer.");
      return;
    }
    setBusy("publish");
    try {
      if (content.trim() && content.trim() !== post.content) {
        await updatePost({ id: post.id, content: content.trim() });
      }
      await publishPost(post.id);
      showSuccess(`Published to ${meta.label}`);
      onOpenChange(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  };

  const handleReschedule = async () => {
    const ts = new Date(`${scheduleDate}T${scheduleTime}`).getTime();
    if (Number.isNaN(ts) || ts <= Date.now()) {
      showError("Pick a future date and time.");
      return;
    }
    setBusy("reschedule");
    try {
      await updatePost({
        id: post.id,
        content: content.trim() || post.content,
        scheduledFor: ts,
        status: "scheduled",
      });
      showSuccess(`Scheduled for ${format(ts, "MMM d 'at' HH:mm")}`);
      onOpenChange(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    setBusy("delete");
    try {
      if (post.status === "scheduled") {
        await updatePost({
          id: post.id,
          scheduledFor: null,
          status: "draft",
        });
        showSuccess("Schedule cancelled — saved as a draft");
      } else {
        await deletePost(post.id);
        showSuccess("Removed from the planner");
      }
      onOpenChange(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    if (!content.trim()) return;
    if (overLimit) {
      showError("X posts must be 280 characters or fewer.");
      return;
    }
    setBusy("save");
    try {
      await updatePost({ id: post.id, content: content.trim() });
      showSuccess("Post updated");
      onOpenChange(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleDuplicate = async () => {
    setBusy("duplicate");
    try {
      await createPost({
        platform: post.platform,
        content: content.trim() || post.content,
        image: post.image,
        prompt: post.prompt,
      });
      showSuccess("Duplicated as a new draft");
      onOpenChange(false);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const handleRefreshMetrics = async () => {
    setBusy("metrics");
    setMetricsError(null);
    try {
      const updated = await refreshPostMetrics(post.id);
      setMetrics(updated.metrics ?? null);
      setMetricsUpdatedAt(updated.metricsUpdatedAt ?? null);
      showSuccess("Performance updated");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setMetricsError(message);
      showError(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span
              className={`grid size-9 place-items-center rounded-xl border ${meta.iconWrapClass}`}
            >
              <SocialPlatformIcon platform={post.platform} className="size-4" />
            </span>
            {meta.label} post
            <PostStatusBadge status={post.status} className="ml-auto" />
          </DialogTitle>
          <DialogDescription>
            {post.status === "posted" && post.postedAt
              ? `Published ${format(post.postedAt, "MMM d, yyyy 'at' HH:mm")}`
              : post.status === "scheduled" && post.scheduledFor
                ? `Scheduled for ${format(post.scheduledFor, "MMM d, yyyy 'at' HH:mm")}`
                : `Created ${format(post.createdAt, "MMM d, yyyy 'at' HH:mm")}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {post.platform === "x" ? (
            <XPostPreview
              displayName={connections?.x.displayName}
              username={
                connections?.x.username ??
                post.externalUrl?.match(/x\.com\/([^/]+)/)?.[1]
              }
              profileImageUrl={connections?.x.profileImageUrl}
              verified={connections?.x.verified}
              content={content}
              image={post.image}
              metrics={metrics}
              timestamp={
                post.postedAt ? format(post.postedAt, "MMM d") : "preview"
              }
              compact
            />
          ) : (
            <div className="space-y-3">
              <p className="whitespace-pre-wrap rounded-xl border border-border bg-muted/45 p-3 text-sm leading-relaxed text-foreground/90">
                {content}
              </p>
              {post.image && (
                <img
                  src={post.image}
                  alt="Post visual"
                  className="max-h-72 w-full rounded-xl border border-border object-cover"
                />
              )}
            </div>
          )}

          {isEditable && (
            <div className="rounded-xl border border-border bg-muted/35 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Edit copy
                </p>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {content.length}
                  {post.platform === "x" ? "/280" : " characters"}
                </span>
              </div>
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={5}
                className="resize-y"
              />
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={handleSave}
                disabled={
                  busy != null ||
                  !content.trim() ||
                  overLimit ||
                  content === post.content
                }
              >
                {busy === "save" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save changes
              </Button>
              {overLimit && (
                <p className="mt-2 text-[11px] text-rose-400">
                  Shorten this post before saving or publishing.
                </p>
              )}
            </div>
          )}

          {post.prompt && (
            <p className="text-[11px] text-muted-foreground">
              Generated from: “{post.prompt}”
            </p>
          )}

          {post.status === "failed" && post.error && (
            <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {post.error}
            </p>
          )}

          {post.platform === "x" && post.status === "posted" && (
            <div className="rounded-xl border border-sky-400/15 bg-sky-500/[0.055] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-sky-200/70">
                    <BarChart3 className="size-3.5" />
                    Performance
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {busy === "metrics" && !metricsUpdatedAt
                      ? "Retrieving live performance from X…"
                      : metricsUpdatedAt
                        ? `Updated ${format(metricsUpdatedAt, "MMM d 'at' HH:mm")}`
                        : "Pull the latest public engagement from X"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshMetrics}
                  disabled={busy != null}
                >
                  {busy === "metrics" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="size-3.5" />
                  )}
                  Refresh
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <PerformanceMetric
                  icon={Heart}
                  label="Likes"
                  value={metrics?.likes}
                />
                <PerformanceMetric
                  icon={Repeat2}
                  label="Reposts"
                  value={metrics?.reposts}
                />
                <PerformanceMetric
                  icon={MessageCircle}
                  label="Replies"
                  value={metrics?.replies}
                />
                <PerformanceMetric
                  icon={BarChart3}
                  label="Impressions"
                  value={metrics?.impressions}
                />
              </div>
              {metricsError && (
                <p
                  role="alert"
                  className="mt-3 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] leading-5 text-rose-300"
                >
                  Could not retrieve X performance: {metricsError}
                </p>
              )}
            </div>
          )}

          {isEditable && (
            <div className="rounded-xl border border-border bg-muted/35 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <CalendarClock className="size-3.5" />
                {post.status === "scheduled" ? "Reschedule" : "Schedule"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-40"
                />
                <Input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-28"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReschedule}
                  disabled={busy != null || overLimit}
                >
                  {busy === "reschedule" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <CalendarClock className="size-3.5" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="ghost"
              className="text-rose-300 hover:text-rose-200"
              onClick={handleDelete}
              disabled={busy != null}
            >
              {busy === "delete" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : post.status === "scheduled" ? (
                <CalendarX2 className="size-4" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {post.status === "scheduled" ? "Cancel schedule" : "Delete"}
            </Button>
            <Button
              variant="ghost"
              onClick={handleDuplicate}
              disabled={busy != null}
            >
              {busy === "duplicate" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Copy className="size-4" />
              )}
              Duplicate
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {post.externalUrl && (
                <Button
                  variant="outline"
                  as="a"
                  href={post.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-4" />
                  View on {meta.label}
                </Button>
              )}
              {isEditable && (
                <Button
                  onClick={handlePublishNow}
                  disabled={busy != null || overLimit}
                >
                  {busy === "publish" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Post now
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PerformanceMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Heart;
  label: string;
  value: number | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-2.5 py-2">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value === undefined ? "—" : value.toLocaleString()}
      </p>
    </div>
  );
}
